import { resolveTikTokUrl } from './resolver.js';
import { parseTikTokUrl, buildCanonicalVideoUrl, buildCanonicalProfileUrl } from './parser.js';
import { fetchVideoMetadataHttp } from './http/video.js';
import { fetchCommentsHttp } from './http/comments.js';
import { resolveProfileHttp, discoverProfileVideosHttp } from './http/profile.js';
import { browserFallback } from './browser/fallback.js';
import {
  NormalizedTikTokVideo,
  NormalizedTikTokProfile,
  NormalizedTikTokComment,
  CommentFetchResult,
  ProfileDiscoveryResult,
  ParsedTikTokUrl,
} from './types.js';
import { logger } from '../../utils/logger.js';

export class TikTokAcquisitionService {
  async parseAndResolveUrl(inputUrl: string): Promise<ParsedTikTokUrl> {
    return await resolveTikTokUrl(inputUrl);
  }

  async getVideo(videoUrl: string): Promise<NormalizedTikTokVideo> {
    // 1. Primary path: Direct HTTP
    try {
      return await fetchVideoMetadataHttp(videoUrl);
    } catch (httpErr: any) {
      logger.warn(`HTTP video acquisition encountered issue: ${httpErr.message}. Invoking browser fallback...`);
      // 2. Browser fallback ONLY when HTTP path is challenged by WAF or fails
      return await browserFallback.getVideoMetadata(videoUrl);
    }
  }

  async getComments(
    videoId: string,
    videoUrl: string,
    options: { maxComments?: number; maxPages?: number } = {}
  ): Promise<CommentFetchResult> {
    // Primary path: Direct HTTP
    return await fetchCommentsHttp(videoId, videoUrl, options);
  }

  async getProfile(username: string): Promise<NormalizedTikTokProfile> {
    // Primary path: Direct HTTP
    return await resolveProfileHttp(username);
  }

  async discoverVideos(
    profile: NormalizedTikTokProfile,
    limit: number = 20
  ): Promise<ProfileDiscoveryResult> {
    // 1. Try HTTP discovery first
    const httpResult = await discoverProfileVideosHttp(profile, limit);

    // If HTTP discovery found enough videos, return immediately
    if (httpResult.videos.length >= limit) {
      return httpResult;
    }

    // 2. Browser fallback ONLY if HTTP path found fewer videos than requested limit
    logger.stage('discover', `HTTP discovery found ${httpResult.videos.length}/${limit} videos. Invoking browser fallback...`);
    try {
      const browserResult = await browserFallback.discoverVideos(profile, limit, httpResult.videos);
      return browserResult;
    } catch (err: any) {
      logger.warn(`Browser fallback failed, returning HTTP discovery results: ${err.message}`);
      return httpResult;
    }
  }

  async close(): Promise<void> {
    await browserFallback.close();
  }
}

export const tiktokAcquisition = new TikTokAcquisitionService();
export * from './types.js';
export { parseTikTokUrl, buildCanonicalVideoUrl, buildCanonicalProfileUrl };
