import path from 'path';
import { tiktokAcquisition, NormalizedTikTokProfile, DiscoveredVideoReference } from '../acquisition/tiktok/index.js';
import { videoCrawler } from './video-crawler.js';
import { localStorage } from '../storage/local-storage.js';
import {
  initProfileCrawlManifest,
  updateProfileCrawlVideo,
  finalizeProfileCrawl,
} from '../storage/manifest.js';
import { ConcurrencyLimiter } from '../utils/concurrency.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { ProfileCrawlManifest } from '../storage/types.js';
import { upsertProfile } from '../storage/database.js';

export interface ProfileProgressEvent {
  stage: 'resolving' | 'discovering' | 'downloading' | 'completed' | 'interrupted' | 'failed';
  current?: number;
  total?: number;
  completed?: number;
  skipped?: number;
  failed?: number;
  videoId?: string;
  videoTitle?: string;
  status?: 'completed' | 'skipped' | 'failed';
  views?: number;
  error?: string;
}

export interface ProfileCrawlerOptions {
  limit?: number;
  concurrency?: number;
  refresh?: boolean;
  refreshComments?: boolean;
  force?: boolean;
  onProgress?: (event: ProfileProgressEvent) => void;
  signal?: AbortSignal;
  profile?: NormalizedTikTokProfile;
}

export class ProfileCrawler {
  private isInterrupted: boolean = false;

  constructor() {
    this.setupGracefulShutdown();
  }

  private setupGracefulShutdown(): void {
    const handleSignal = async (signal: string) => {
      if (this.isInterrupted) return;
      this.isInterrupted = true;
      console.log(`\n[SHUTDOWN] Received ${signal}. Gracefully stopping new tasks and saving manifest...`);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
  }

  async crawl(profileUrl: string, options: ProfileCrawlerOptions = {}): Promise<ProfileCrawlManifest | null> {
    this.isInterrupted = false;
    const parsed = await tiktokAcquisition.parseAndResolveUrl(profileUrl);

    if (parsed.type !== 'profile' || !parsed.username) {
      throw new Error(`Invalid TikTok profile URL: ${profileUrl}`);
    }

    const username = parsed.username;
    const limit = options.limit ?? 20;
    const concurrency = options.concurrency ?? config.videoConcurrency;

    options.onProgress?.({ stage: 'resolving', videoTitle: `@${username}` });

    // 1. Resolve Profile Details
    const profile = options.profile || (await tiktokAcquisition.getProfile(username));
    const profileId = profile.profile_id;
    const profileDir = localStorage.getProfileDir(profileId);
    await localStorage.ensureDir(profileDir);

    // Save profile.json
    const profileFile = path.join(profileDir, 'profile.json');
    await localStorage.writeJson(profileFile, profile);
    logger.stage('profile', `Saved profile information to ${profileFile}`);

    try {
      upsertProfile({
        profile_id: profile.profile_id,
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        profile_url: profile.profile_url,
        followers: profile.stats.followers,
        following: profile.stats.following,
        likes: profile.stats.likes,
        videos_count: profile.stats.videos,
        status: 'completed',
        sec_uid: profile.sec_uid,
      });
    } catch (e: any) {
      logger.warn(`Failed to index profile @${username} into SQLite: ${e.message}`);
    }

    const targetTotal = (limit && limit > 0)
      ? Math.min(limit, profile.stats.videos > 0 ? profile.stats.videos : limit)
      : (profile.stats.videos || 20);

    options.onProgress?.({
      stage: 'discovering',
      total: targetTotal,
      videoTitle: profile.display_name || `@${username}`,
    });

    // 2. Initialize / Load crawl-manifest.json
    const crawlManifest = await initProfileCrawlManifest(
      profileId,
      username,
      profile.profile_url,
      targetTotal
    );

    // 3. Process Videos with Streaming Concurrency Limiter
    const limiter = new ConcurrencyLimiter(concurrency);
    const allDownloadTasks: Promise<void>[] = [];
    const queuedVideoIds = new Set<string>();

    let completedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const processVideo = (vidRef: DiscoveredVideoReference, index: number) => {
      if (queuedVideoIds.has(vidRef.video_id)) return;
      queuedVideoIds.add(vidRef.video_id);

      const task = limiter.run(async () => {
        if (this.isInterrupted || options.signal?.aborted) {
          return;
        }

        const currentNum = index + 1;
        const videoTitle = vidRef.normalized?.content?.description || vidRef.description || vidRef.video_id;
        console.log(`\n[${currentNum}/${targetTotal}] Processing video: ${vidRef.video_id}`);

        options.onProgress?.({
          stage: 'downloading',
          current: completedCount + skippedCount,
          total: targetTotal,
          videoId: vidRef.video_id,
          videoTitle,
        });

        try {
          const result = await videoCrawler.crawl(vidRef.url, {
            profileId,
            refresh: options.refresh,
            refreshComments: options.refreshComments,
            force: options.force,
            metadata: vidRef.normalized,
            deferComments: !options.refreshComments,
          });

          if (result.status === 'completed') {
            completedCount++;
            await updateProfileCrawlVideo(profileId, vidRef.video_id, 'completed');
          } else if (result.status === 'skipped') {
            skippedCount++;
            await updateProfileCrawlVideo(profileId, vidRef.video_id, 'skipped');
          } else {
            failedCount++;
            await updateProfileCrawlVideo(profileId, vidRef.video_id, 'failed', result.error);
          }

          options.onProgress?.({
            stage: 'downloading',
            current: completedCount + skippedCount,
            total: targetTotal,
            videoId: vidRef.video_id,
            videoTitle,
            status: result.status,
            views: vidRef.normalized?.engagement?.views || 0,
            error: result.error,
          });
        } catch (err: any) {
          failedCount++;
          await updateProfileCrawlVideo(profileId, vidRef.video_id, 'failed', err.message);
          logger.error(`Error processing video ${vidRef.video_id}`, err);

          options.onProgress?.({
            stage: 'downloading',
            current: completedCount + skippedCount,
            total: targetTotal,
            videoId: vidRef.video_id,
            videoTitle,
            status: 'failed',
            error: err.message,
          });
        }
      });

      allDownloadTasks.push(task);
    };

    // 4. Live discovery with immediate streaming to workers
    const discovery = await tiktokAcquisition.discoverVideos(profile, limit, (vidRef, count) => {
      processVideo(vidRef, count - 1);
    });

    // Enqueue any remaining discovered videos that arrived before listener attached
    discovery.videos.forEach((vidRef, idx) => {
      processVideo(vidRef, idx);
    });

    // Save videos.json
    const videosFile = path.join(profileDir, 'videos.json');
    await localStorage.writeJson(videosFile, discovery);
    logger.stage('discover', `Saved ${discovery.videos.length} discovered videos to ${videosFile}`);

    console.log(`[DISCOVER] ${discovery.videos.length} videos discovered (method: ${discovery.method})`);

    // 5. Await all in-flight download tasks
    await Promise.all(allDownloadTasks);

    // 6. Finalize Manifest & Print Summary
    const total = discovery.videos.length;
    const isAborted = this.isInterrupted || Boolean(options.signal?.aborted);
    const finalStatus = isAborted ? 'interrupted' : 'completed';
    const finalManifest = await finalizeProfileCrawl(profileId, finalStatus);

    options.onProgress?.({
      stage: finalStatus === 'completed' ? 'completed' : 'interrupted',
      current: completedCount + skippedCount,
      total,
      completed: completedCount,
      skipped: skippedCount,
      failed: failedCount,
    });

    console.log(`\n[SUMMARY] Profile crawl @${username}`);
    console.log(`Discovered: ${total}`);
    console.log(`Completed:  ${completedCount}`);
    console.log(`Skipped:    ${skippedCount}`);
    console.log(`Failed:     ${failedCount}`);
    console.log(`Status:     ${finalStatus}`);
    console.log(`Saved in:   ${profileDir}\n`);

    return finalManifest;
  }
}

export const profileCrawler = new ProfileCrawler();
