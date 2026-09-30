import { logger } from '../../utils/logger.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { withRetry } from '../../utils/retry.js';

export interface ResolvedMediaInfo {
  video_url?: string;
  images?: string[];
  is_photo_mode?: boolean;
  music_url?: string;
  title?: string;
}

class TikTokMediaResolver {
  // Free TikWM API has a 1 request / second rate limit
  private rateLimiter = new RateLimiter(1100);

  async resolveMedia(videoUrl: string, videoId: string): Promise<ResolvedMediaInfo | null> {
    logger.stage('resolve', `Attempting fallback media resolution for video ${videoId}...`);

    return await withRetry(
      async () => {
        await this.rateLimiter.acquire();

        const endpoints = [
          `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`,
          `https://tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`,
        ];

        let lastError: Error | null = null;

        for (const ep of endpoints) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(ep, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
              },
              signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
              continue;
            }

            const data = await res.json();

            // Handle rate limit message
            if (data.msg && data.msg.includes('Free Api Limit')) {
              throw new Error(`TikWM Rate limited: ${data.msg}`);
            }

            if (data.code === 0 && data.data) {
              const d = data.data;

              // Check if Photo Mode (Slideshow)
              if (Array.isArray(d.images) && d.images.length > 0) {
                logger.stage('resolve', `Resolved video ${videoId} as photo mode (${d.images.length} images)`);
                return {
                  images: d.images,
                  is_photo_mode: true,
                  music_url: d.music || undefined,
                  title: d.title,
                };
              }

              // Normal MP4 video (prioritize no-watermark 'play', fallback to 'wmplay')
              const videoUrl = d.play || d.wmplay;
              if (videoUrl) {
                logger.stage('resolve', `Successfully resolved direct stream URL for video ${videoId}`);
                return {
                  video_url: videoUrl,
                  music_url: d.music || undefined,
                  title: d.title,
                  is_photo_mode: false,
                };
              }
            }
          } catch (err: any) {
            lastError = err;
            if (err.message && err.message.includes('Rate limited')) {
              throw err; // Trigger retry backoff
            }
          }
        }

        if (lastError) {
          throw lastError;
        }

        return null;
      },
      {
        maxRetries: 3,
        initialDelayMs: 1500,
        timeoutMs: 15000,
        shouldRetry: (err) => {
          return err.message?.includes('Rate limited') || err.name === 'AbortError';
        },
      }
    ).catch((err: any) => {
      logger.warn(`Media resolver failed for video ${videoId}: ${err.message}`);
      return null;
    });
  }
}

export const mediaResolver = new TikTokMediaResolver();
