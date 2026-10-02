import { resolveTikTokUrl } from './resolver.js';
import { parseTikTokUrl, buildCanonicalVideoUrl, buildCanonicalProfileUrl } from './parser.js';
import { fetchVideoMetadataHttp } from './http/video.js';
import { fetchCommentsHttp } from './http/comments.js';
import { resolveProfileHttp, discoverProfileVideosHttp } from './http/profile.js';
import { browserFallback } from './browser/fallback.js';
import { tikwmService } from './thirdparty/tikwm.js';
import { config } from '../../config/index.js';
import {
  NormalizedTikTokVideo,
  NormalizedTikTokProfile,
  NormalizedTikTokComment,
  CommentFetchResult,
  ProfileDiscoveryResult,
  DiscoveredVideoReference,
  OnVideoDiscoveredCallback,
  ParsedTikTokUrl,
} from './types.js';
import { logger } from '../../utils/logger.js';

export class TikTokAcquisitionService {
  async parseAndResolveUrl(inputUrl: string): Promise<ParsedTikTokUrl> {
    return await resolveTikTokUrl(inputUrl);
  }

  async getVideo(videoUrl: string): Promise<NormalizedTikTokVideo> {
    // 1. Primary path: 3rd-party acquisition (TikWM) - fast, bypasses web WAF, provides no-watermark stream
    if (config.enableTikwm) {
      try {
        return await tikwmService.fetchVideo(videoUrl);
      } catch (tikwmErr: any) {
        logger.warn(`TikWM video acquisition encountered issue: ${tikwmErr.message}. Falling back to direct HTTP...`);
      }
    }

    // 2. Secondary path: Direct TikTok HTTP
    try {
      return await fetchVideoMetadataHttp(videoUrl);
    } catch (httpErr: any) {
      logger.warn(`HTTP video acquisition encountered issue: ${httpErr.message}. Invoking browser fallback (Playwright)...`);
      // 3. Fallback path: Playwright browser fallback when challenged by anti-bot/WAF
      return await browserFallback.getVideoMetadata(videoUrl);
    }
  }

  async getComments(
    videoId: string,
    videoUrl: string,
    options: { maxComments?: number; maxPages?: number } = {}
  ): Promise<CommentFetchResult> {
    // 1. Primary path: 3rd-party acquisition (TikWM)
    if (config.enableTikwm) {
      try {
        const tikwmResult = await tikwmService.fetchComments(videoId, videoUrl, options);
        if (tikwmResult.status === 'completed' && tikwmResult.comments.length > 0) {
          return tikwmResult;
        }
        logger.debug(`TikWM returned 0 comments or status ${tikwmResult.status}. Falling back to direct HTTP...`);
      } catch (tikwmErr: any) {
        logger.warn(`TikWM comments acquisition encountered issue: ${tikwmErr.message}. Falling back to direct HTTP...`);
      }
    }

    // 2. Secondary path: Direct TikTok HTTP
    return await fetchCommentsHttp(videoId, videoUrl, options);
  }

  async getProfile(username: string): Promise<NormalizedTikTokProfile> {
    // Primary path: Direct HTTP
    return await resolveProfileHttp(username);
  }

  async discoverVideos(
    profile: NormalizedTikTokProfile,
    limit: number = 20,
    onVideoDiscovered?: OnVideoDiscoveredCallback
  ): Promise<ProfileDiscoveryResult> {
    // 1. Try HTTP discovery first
    const httpResult = await discoverProfileVideosHttp(profile, limit);

    if (onVideoDiscovered && httpResult.videos.length > 0) {
      for (let i = 0; i < httpResult.videos.length; i++) {
        onVideoDiscovered(httpResult.videos[i], i + 1);
      }
    }

    // If HTTP discovery found enough videos, return immediately
    if (httpResult.videos.length >= limit) {
      return httpResult;
    }

    // 2. Browser fallback ONLY if HTTP path found fewer videos than requested limit
    logger.stage('discover', `HTTP discovery found ${httpResult.videos.length}/${limit} videos. Invoking browser fallback...`);
    try {
      const browserResult = await browserFallback.discoverVideos(
        profile,
        limit,
        httpResult.videos,
        onVideoDiscovered
      );
      return browserResult;
    } catch (err: any) {
      logger.warn(`Browser fallback failed, returning HTTP discovery results: ${err.message}`);
      return httpResult;
    }
  }

  async prewarmBrowser(): Promise<void> {
    await browserFallback.prewarm();
  }

  async close(): Promise<void> {
    await browserFallback.close();
  }
}

export const tiktokAcquisition = new TikTokAcquisitionService();
export * from './types.js';
export * from './thirdparty/index.js';
export { parseTikTokUrl, buildCanonicalVideoUrl, buildCanonicalProfileUrl };
