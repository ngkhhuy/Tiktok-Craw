import { logger } from '../../utils/logger.js';
import { tikwmService, TikWMMediaInfo } from './thirdparty/tikwm.js';

export type ResolvedMediaInfo = TikWMMediaInfo;

class TikTokMediaResolver {
  async resolveMedia(videoUrl: string, videoId: string): Promise<ResolvedMediaInfo | null> {
    logger.stage('resolve', `Attempting fallback media resolution for video ${videoId}...`);
    return await tikwmService.resolveMedia(videoUrl, videoId);
  }
}

export const mediaResolver = new TikTokMediaResolver();
