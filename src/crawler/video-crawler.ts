import path from 'path';
import fs from 'fs';
import { tiktokAcquisition } from '../acquisition/tiktok/index.js';
import { mediaDownloader } from '../downloader/media-downloader.js';
import { runFfprobe } from '../media/ffprobe.js';
import { localStorage } from '../storage/local-storage.js';
import {
  isVideoCompleted,
  createInitialVideoManifest,
  saveVideoManifest,
  loadVideoManifest,
} from '../storage/manifest.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { VideoManifest } from '../storage/types.js';
import { NormalizedTikTokVideo } from '../acquisition/tiktok/types.js';
import { mediaResolver } from '../acquisition/tiktok/media-resolver.js';
import { insertMetricSnapshot, upsertVideo } from '../storage/database.js';
import { ConcurrencyLimiter } from '../utils/concurrency.js';

// A profile crawl may schedule many video tasks, but each TikTok-facing
// operation uses its own bounded pool. This prevents 16 video tasks from
// becoming 48 simultaneous CDN/API requests.
const metadataLimiter = new ConcurrencyLimiter(config.metadataConcurrency);
const mediaLimiter = new ConcurrencyLimiter(config.mediaConcurrency);
const commentsLimiter = new ConcurrencyLimiter(config.commentConcurrency);

export interface VideoCrawlerOptions {
  profileId?: string;
  refresh?: boolean;
  refreshComments?: boolean;
  force?: boolean;
  metadata?: NormalizedTikTokVideo;
  /** Complete a bulk profile crawl after media is ready; comments continue in the bounded background queue. */
  deferComments?: boolean;
}

export interface VideoCrawlResult {
  videoId: string;
  status: 'completed' | 'skipped' | 'failed';
  videoDir: string;
  error?: string;
  manifest?: VideoManifest;
}

export class VideoCrawler {
  async crawl(inputUrl: string, options: VideoCrawlerOptions = {}): Promise<VideoCrawlResult> {
    logger.stage('video', `Starting video processing: ${inputUrl}`);

    // 1. Resolve & Canonicalize URL
    const parsed = await tiktokAcquisition.parseAndResolveUrl(inputUrl);

    if (parsed.type !== 'video' || !parsed.videoId) {
      throw new Error(`Invalid TikTok video URL: ${inputUrl}`);
    }

    const videoId = parsed.videoId;
    const targetUrl = parsed.canonicalUrl || parsed.rawUrl;
    const videoDir = localStorage.getVideoDir(videoId, options.profileId);
    await localStorage.ensureDir(videoDir);

    const videoFile = path.join(videoDir, 'video.mp4');
    const thumbnailFile = path.join(videoDir, 'thumbnail.jpg');
    const metadataFile = path.join(videoDir, 'metadata.json');
    const technicalFile = path.join(videoDir, 'technical.json');
    const commentsFile = path.join(videoDir, 'comments.json');
    const manifestFile = path.join(videoDir, 'manifest.json');

    // 2. Check Idempotency / Resume
    const alreadyCompleted = isVideoCompleted(videoDir);

    if (alreadyCompleted && !options.force && !options.refresh && !options.refreshComments) {
      logger.stage('video', `Video ${videoId} is already completed. Skipping.`);
      logger.videoProgress(videoId, 'already processed', 'skipped');
      const existingManifest = await loadVideoManifest(videoDir);

      try {
        let metaObj: any = null;
        if (fs.existsSync(metadataFile)) {
          metaObj = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
        }
        let techObj: any = null;
        if (fs.existsSync(technicalFile)) {
          try { techObj = JSON.parse(fs.readFileSync(technicalFile, 'utf-8')); } catch {}
        }
        const videoFileSize = fs.existsSync(videoFile) ? fs.statSync(videoFile).size : 0;
        upsertVideo({
          video_id: videoId,
          profile_id: options.profileId || null,
          username: metaObj?.author?.username || '',
          display_name: metaObj?.author?.display_name || '',
          avatar_url: metaObj?.author?.avatar_url || '',
          description: metaObj?.content?.description || '',
          published_at: metaObj?.published_at || null,
          views: metaObj?.engagement?.views || 0,
          likes: metaObj?.engagement?.likes || 0,
          comments_count: metaObj?.engagement?.comments || 0,
          shares: metaObj?.engagement?.shares || 0,
          saves: metaObj?.engagement?.saves || 0,
          duration: techObj?.duration || metaObj?.media?.duration || 0,
          width: techObj?.width || metaObj?.media?.width || 0,
          height: techObj?.height || metaObj?.media?.height || 0,
          fps: techObj?.fps || 0,
          video_codec: techObj?.video_codec || '',
          file_size: videoFileSize,
          sha256: existingManifest?.hash?.value || null,
          status: 'completed',
          is_photo_mode: Boolean(metaObj?.media?.is_photo_mode),
          directory: videoDir,
        });
      } catch {}

      return {
        videoId,
        status: 'skipped',
        videoDir,
        manifest: existingManifest || undefined,
      };
    }

    // Initialize or load manifest
    let manifest = (await loadVideoManifest(videoDir)) || createInitialVideoManifest(videoId, targetUrl);
    manifest.started_at = manifest.started_at || new Date().toISOString();
    manifest.status = 'running';

    console.log(`\n[VIDEO] ${videoId}`);

    try {
      // 3. Acquire Metadata (if needed)
      let metadata: any = null;
      let metadataCapturedAt: string | null = null;
      const needMetadata = options.force || options.refresh || !fs.existsSync(metadataFile);

      if (needMetadata) {
        manifest.stages.metadata.started_at = new Date().toISOString();
        if (options.metadata) {
          metadata = options.metadata;
        } else {
          metadata = await metadataLimiter.run(() => tiktokAcquisition.getVideo(targetUrl));
        }
        await localStorage.writeJson(metadataFile, metadata);
        metadataCapturedAt = new Date().toISOString();
        manifest.stages.metadata.status = 'completed';
        manifest.stages.metadata.completed_at = metadataCapturedAt;
        manifest.files.metadata = 'metadata.json';
        logger.videoProgress(videoId, 'metadata', 'success');
      } else {
        metadata = await localStorage.readJson(metadataFile);
        logger.videoProgress(videoId, 'metadata', 'skipped', 'cached');
      }

      // Handle only comment refresh mode
      if (options.refreshComments && !options.force) {
        manifest.stages.comments.started_at = new Date().toISOString();
        const commentsResult = await commentsLimiter.run(() => tiktokAcquisition.getComments(videoId, targetUrl));
        await localStorage.writeJson(commentsFile, commentsResult);
        manifest.stages.comments.status = commentsResult.status;
        manifest.stages.comments.completed_at = new Date().toISOString();
        manifest.stages.comments.count = commentsResult.comments.length;
        manifest.files.comments = 'comments.json';
        logger.videoProgress(videoId, 'comments', commentsResult.status === 'completed' ? 'success' : 'unavailable', `${commentsResult.comments.length} items`);

        manifest.status = 'completed';
        manifest.completed_at = new Date().toISOString();
        await saveVideoManifest(videoDir, manifest);
        console.log(`[RESULT] comments refreshed for ${videoId}\n`);
        return { videoId, status: 'completed', videoDir, manifest };
      }

      // 4. Resolve Media URL if missing (e.g. TikTok Shop / restricted videos)
      let mediaUrl = metadata?.media?.video_url;
      let isPhotoMode = Boolean(
        metadata?.media?.is_photo_mode ||
        (metadata?.media?.images && metadata.media.images.length > 0) ||
        metadata?.platform_specific?.imagePost
      );

      if (!mediaUrl && !isPhotoMode) {
        logger.stage('video', `Media URL missing for ${videoId}, triggering fallback resolver...`);
        const resolved = await mediaResolver.resolveMedia(targetUrl, videoId);
        if (resolved?.video_url) {
          mediaUrl = resolved.video_url;
          metadata.media = metadata.media || {};
          metadata.media.video_url = resolved.video_url;
          if (resolved.music_url && !metadata.media.music_url) {
            metadata.media.music_url = resolved.music_url;
          }
          await localStorage.writeJson(metadataFile, metadata);
        } else if (resolved?.images && resolved.images.length > 0) {
          metadata.media = metadata.media || {};
          metadata.media.images = resolved.images;
          metadata.media.is_photo_mode = true;
          isPhotoMode = true;
          if (resolved.music_url && !metadata.media.music_url) {
            metadata.media.music_url = resolved.music_url;
          }
          await localStorage.writeJson(metadataFile, metadata);
        }
      }

      if (!mediaUrl && !isPhotoMode) {
        throw new Error(`No media video URL found for video ${videoId}`);
      }

      let sha256Val = manifest.hash?.value;

      // Pipeline Task A: Video Download (or Slideshow) -> FFprobe -> Hash
      const videoPipeline = async () => {
        const needVideo = options.force || !fs.existsSync(videoFile) || fs.statSync(videoFile).size === 0;

        if (needVideo) {
          manifest.stages.video.started_at = new Date().toISOString();

          if (isPhotoMode && !mediaUrl) {
            // Photo Mode (Slideshow / Image Carousel) Processing
            logger.stage('video', `Processing Photo Mode (slideshow) for item ${videoId}`);
            const photoImages: string[] = metadata?.media?.images && metadata.media.images.length > 0
              ? metadata.media.images
              : (metadata?.platform_specific?.imagePost?.images || []).map((img: any) =>
                  img.imageURL?.urlList?.[0] || img.imageURL?.urlList?.[1] || img.display_image?.url_list?.[0]
                ).filter(Boolean);

            const imagesDir = path.join(videoDir, 'images');
            await localStorage.ensureDir(imagesDir);

            const downloadedImages: string[] = [];
            for (let i = 0; i < photoImages.length; i++) {
              const imgPath = path.join(imagesDir, `img_${i}.jpg`);
              await mediaLimiter.run(() =>
                mediaDownloader.downloadThumbnail(photoImages[i], imgPath, { referer: targetUrl })
              );
              if (fs.existsSync(imgPath) && fs.statSync(imgPath).size > 0) {
                downloadedImages.push(imgPath);
              }
            }

            // Download music audio if available
            let audioFile: string | null = null;
            const musicUrl = metadata?.media?.music_url || metadata?.platform_specific?.music?.playUrl;
            if (musicUrl) {
              try {
                const audioPath = path.join(videoDir, 'audio.mp3');
                const aRes = await fetch(musicUrl);
                if (aRes.ok) {
                  const buf = Buffer.from(await aRes.arrayBuffer());
                  fs.writeFileSync(audioPath, buf);
                  audioFile = audioPath;
                }
              } catch (err: any) {
                logger.debug(`Could not download music for photo mode: ${err.message}`);
              }
            }

            // Generate playable MP4 slideshow via FFmpeg
            await buildSlideshowMp4(downloadedImages, audioFile, videoFile);

            const { calculateFileSha256 } = await import('../downloader/hash.js');
            sha256Val = await calculateFileSha256(videoFile);
            manifest.stages.video.status = 'completed';
            manifest.stages.video.completed_at = new Date().toISOString();
            manifest.files.video = 'video.mp4';
            logger.videoProgress(videoId, 'video', 'success', `slideshow (${(fs.statSync(videoFile).size / 1024 / 1024).toFixed(2)} MB)`);

            manifest.stages.hash.status = 'completed';
            manifest.stages.hash.completed_at = new Date().toISOString();
            manifest.hash = { algorithm: 'sha256', value: sha256Val };
            logger.videoProgress(videoId, 'sha256', 'success', sha256Val.slice(0, 12) + '...');
          } else {
            // Regular MP4 Video Download
            let downloadRes;
            try {
              downloadRes = await mediaLimiter.run(() =>
                mediaDownloader.downloadVideo(mediaUrl!, videoFile, {
                  cookies: metadata?.cookies,
                  referer: targetUrl,
                })
              );
            } catch (dlErr: any) {
              logger.warn(`Direct media download failed for ${videoId} (${dlErr.message}). Falling back to media resolver...`);
              const resolved = await mediaResolver.resolveMedia(targetUrl, videoId);
              if (resolved?.video_url) {
                mediaUrl = resolved.video_url;
                downloadRes = await mediaLimiter.run(() =>
                  mediaDownloader.downloadVideo(mediaUrl!, videoFile, {
                    referer: targetUrl,
                  })
                );
              } else {
                throw dlErr;
              }
            }

            sha256Val = downloadRes.sha256;
            manifest.stages.video.status = 'completed';
            manifest.stages.video.completed_at = new Date().toISOString();
            manifest.files.video = 'video.mp4';
            logger.videoProgress(videoId, 'video', 'success', `${(downloadRes.bytesDownloaded / 1024 / 1024).toFixed(2)} MB`);

            manifest.stages.hash.status = 'completed';
            manifest.stages.hash.completed_at = new Date().toISOString();
            manifest.hash = { algorithm: 'sha256', value: sha256Val };
            logger.videoProgress(videoId, 'sha256', 'success', sha256Val.slice(0, 12) + '...');
          }
        } else {
          logger.videoProgress(videoId, 'video', 'skipped', 'already downloaded');
          if (!manifest.hash && fs.existsSync(videoFile)) {
            const { calculateFileSha256 } = await import('../downloader/hash.js');
            sha256Val = await calculateFileSha256(videoFile);
            manifest.hash = { algorithm: 'sha256', value: sha256Val };
          }
          logger.videoProgress(videoId, 'sha256', 'success');
        }

        // FFprobe Technical Metadata Analysis
        const needTech = options.force || !fs.existsSync(technicalFile);
        if (needTech && fs.existsSync(videoFile)) {
          manifest.stages.technical.started_at = new Date().toISOString();
          const techData = await runFfprobe(videoFile);
          await localStorage.writeJson(technicalFile, techData);
          manifest.stages.technical.status = 'completed';
          manifest.stages.technical.completed_at = new Date().toISOString();
          manifest.files.technical = 'technical.json';
          logger.videoProgress(videoId, 'technical', 'success', `${techData.width}x${techData.height} ${techData.fps}fps`);
        } else if (fs.existsSync(technicalFile)) {
          logger.videoProgress(videoId, 'technical', 'skipped', 'cached');
        }
      };

      // Pipeline Task B: Thumbnail Download
      const thumbPipeline = async () => {
        const needThumb = options.force || !fs.existsSync(thumbnailFile);
        const thumbUrl = metadata?.media?.thumbnail_url || (metadata?.media?.images && metadata.media.images[0]);
        if (needThumb && thumbUrl) {
          manifest.stages.thumbnail.started_at = new Date().toISOString();
          const thumbOk = await mediaLimiter.run(() =>
            mediaDownloader.downloadThumbnail(thumbUrl, thumbnailFile, {
              referer: targetUrl,
            })
          );

          if (thumbOk) {
            manifest.stages.thumbnail.status = 'completed';
            manifest.stages.thumbnail.completed_at = new Date().toISOString();
            manifest.files.thumbnail = 'thumbnail.jpg';
            logger.videoProgress(videoId, 'thumbnail', 'success');
          } else {
            manifest.stages.thumbnail.status = 'unavailable';
            logger.videoProgress(videoId, 'thumbnail', 'unavailable');
          }
        } else if (fs.existsSync(thumbnailFile)) {
          logger.videoProgress(videoId, 'thumbnail', 'skipped', 'cached');
        } else {
          manifest.stages.thumbnail.status = 'unavailable';
          logger.videoProgress(videoId, 'thumbnail', 'unavailable');
        }
      };

      // Pipeline Task C: Comments Extraction
      const commentsPipeline = async () => {
        const needComments = options.force || !fs.existsSync(commentsFile);
        if (needComments) {
          manifest.stages.comments.started_at = new Date().toISOString();
          const commentsResult = await commentsLimiter.run(() => tiktokAcquisition.getComments(videoId, targetUrl));
          await localStorage.writeJson(commentsFile, commentsResult);
          manifest.stages.comments.status = commentsResult.status;
          manifest.stages.comments.completed_at = new Date().toISOString();
          manifest.stages.comments.count = commentsResult.comments.length;
          manifest.files.comments = 'comments.json';
          logger.videoProgress(
            videoId,
            'comments',
            commentsResult.status === 'completed' ? 'success' : 'unavailable',
            `${commentsResult.comments.length} comments`
          );
        } else {
          logger.videoProgress(videoId, 'comments', 'skipped', 'cached');
        }
      };

      // A profile crawl should report completed media as soon as it is usable.
      // Comments remain bounded in their own background queue so pagination
      // cannot serialize all video completions. A direct single-video crawl
      // keeps the original behavior and waits for comments.
      if (options.deferComments) {
        await Promise.all([videoPipeline(), thumbPipeline()]);
      } else {
        await Promise.all([videoPipeline(), thumbPipeline(), commentsPipeline()]);
      }

      // 8. Finalize Manifest & Index to Database
      manifest.status = 'completed';
      manifest.completed_at = new Date().toISOString();
      delete manifest.error;
      await saveVideoManifest(videoDir, manifest);

      try {
        let techObj: any = null;
        if (fs.existsSync(technicalFile)) {
          try { techObj = JSON.parse(fs.readFileSync(technicalFile, 'utf-8')); } catch {}
        }
        let comCount = metadata?.engagement?.comments || 0;
        if (fs.existsSync(commentsFile)) {
          try {
            const comObj = JSON.parse(fs.readFileSync(commentsFile, 'utf-8'));
            if (Array.isArray(comObj?.comments)) comCount = comObj.comments.length;
          } catch {}
        }
        const videoFileSize = fs.existsSync(videoFile) ? fs.statSync(videoFile).size : 0;

        upsertVideo({
          video_id: videoId,
          profile_id: options.profileId || null,
          username: metadata?.author?.username || '',
          display_name: metadata?.author?.display_name || '',
          avatar_url: metadata?.author?.avatar_url || '',
          description: metadata?.content?.description || '',
          published_at: metadata?.published_at || null,
          views: metadata?.engagement?.views || 0,
          likes: metadata?.engagement?.likes || 0,
          comments_count: comCount,
          shares: metadata?.engagement?.shares || 0,
          saves: metadata?.engagement?.saves || 0,
          duration: techObj?.duration || metadata?.media?.duration || 0,
          width: techObj?.width || metadata?.media?.width || 0,
          height: techObj?.height || metadata?.media?.height || 0,
          fps: techObj?.fps || 0,
          video_codec: techObj?.video_codec || '',
          file_size: videoFileSize,
          sha256: manifest.hash?.value || null,
          status: 'completed',
          is_photo_mode: Boolean(metadata?.media?.is_photo_mode),
          directory: videoDir,
        });

        // Add a time-series point only when fresh metadata was observed from
        // TikTok. Resuming a file download must not look like a new metric
        // observation.
        if (metadataCapturedAt) {
          insertMetricSnapshot({
            video_id: videoId,
            captured_at: metadataCapturedAt,
            views: metadata?.engagement?.views || 0,
            likes: metadata?.engagement?.likes || 0,
            comments_count: metadata?.engagement?.comments || 0,
            shares: metadata?.engagement?.shares || 0,
            saves: metadata?.engagement?.saves || 0,
          });
        }
      } catch (dbErr: any) {
        logger.warn(`Failed to index video ${videoId} into database: ${dbErr.message}`);
      }

      if (options.deferComments && (options.force || !fs.existsSync(commentsFile))) {
        logger.videoProgress(videoId, 'comments', 'started', 'background queue');
        void commentsPipeline()
          .catch((commentsErr: any) => {
            manifest.stages.comments.status = 'failed';
            manifest.stages.comments.completed_at = new Date().toISOString();
            logger.warn(`Background comments fetch failed for ${videoId}: ${commentsErr.message}`);
          })
          .finally(async () => {
            try {
              await saveVideoManifest(videoDir, manifest);
            } catch (saveErr: any) {
              logger.warn(`Could not save background comment status for ${videoId}: ${saveErr.message}`);
            }
          });
      }

      console.log(`[RESULT] completed ${videoId}\n`);

      return {
        videoId,
        status: 'completed',
        videoDir,
        manifest,
      };
    } catch (err: any) {
      manifest.status = 'failed';
      manifest.error = {
        message: err.message,
        stage: 'download',
      };
      await saveVideoManifest(videoDir, manifest);
      logger.error(`Video ingestion failed for ${videoId}: ${err.message}`);
      console.log(`[RESULT] failed ${videoId}\n`);

      return {
        videoId,
        status: 'failed',
        videoDir,
        error: err.message,
        manifest,
      };
    }
  }
}

export const videoCrawler = new VideoCrawler();

async function buildSlideshowMp4(images: string[], audioFile: string | null, outputFile: string): Promise<void> {
  if (images.length === 0) {
    throw new Error('No images available to create slideshow');
  }

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const concatFile = path.join(path.dirname(outputFile), 'concat.txt');
  let concatContent = '';
  for (const img of images) {
    concatContent += `file '${img.replace(/\\/g, '/')}'\n`;
    concatContent += 'duration 3.0\n';
  }
  concatContent += `file '${images[images.length - 1].replace(/\\/g, '/')}'\n`;
  fs.writeFileSync(concatFile, concatContent);

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
  ];

  if (audioFile && fs.existsSync(audioFile)) {
    args.push('-i', audioFile);
    args.push(
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:a', 'aac',
      '-shortest',
      outputFile
    );
  } else {
    args.push(
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      outputFile
    );
  }

  await execFileAsync(config.ffmpegPath, args);

  if (fs.existsSync(concatFile)) {
    try { fs.unlinkSync(concatFile); } catch {}
  }
}
