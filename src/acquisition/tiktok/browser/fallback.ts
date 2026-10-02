import path from 'path';
import fs from 'fs';
import { chromium, BrowserContext } from 'playwright';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import {
  NormalizedTikTokProfile,
  NormalizedTikTokVideo,
  ProfileDiscoveryResult,
  DiscoveredVideoReference,
  OnVideoDiscoveredCallback,
} from '../types.js';
import { extractRehydrationData, normalizeVideoMetadata } from '../http/video.js';

export class BrowserFallbackService {
  private context: BrowserContext | null = null;

  async prewarm(): Promise<void> {
    try {
      if (!this.context) {
        await this.getContext();
        logger.stage('browser', 'Browser persistent context pre-warmed successfully');
      }
    } catch (err: any) {
      logger.debug(`Browser prewarm ignored: ${err.message}`);
    }
  }

  private async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;

    const userDataDir = path.join(config.dataDir, '.browser_session');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    logger.stage('browser', 'Launching persistent browser session (Playwright msedge/chromium)...');

    const launchOptions = {
      headless: config.headless,
      viewport: { width: 1440, height: 900 },
      userAgent: config.userAgentDesktop,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    };

    try {
      this.context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        channel: 'msedge',
      });
    } catch (err: any) {
      logger.debug(`Persistent context launch failed (${err.message}), falling back to isolated Edge browser instance`);
      try {
        const browser = await chromium.launch({
          headless: config.headless,
          channel: 'msedge',
          args: launchOptions.args,
        });
        this.context = await browser.newContext({
          viewport: launchOptions.viewport,
          userAgent: launchOptions.userAgent,
        });
      } catch {
        this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
      }
    }

    return this.context;
  }

  async close(): Promise<void> {
    if (this.context) {
      logger.stage('browser', 'Closing browser session');
      await this.context.close();
      this.context = null;
    }
  }

  async discoverVideos(
    profile: NormalizedTikTokProfile,
    limit: number = 20,
    existingVideos: DiscoveredVideoReference[] = [],
    onVideoDiscovered?: OnVideoDiscoveredCallback
  ): Promise<ProfileDiscoveryResult> {
    logger.stage('browser', `Executing browser fallback for @${profile.username} (target limit: ${limit})`);

    const context = await this.getContext();
    const videos: DiscoveredVideoReference[] = [...existingVideos];
    const seenVideoIds = new Set<string>(existingVideos.map(v => v.video_id));
    const targetUsername = profile.username.toLowerCase();

    const page = await context.newPage();

    try {
      const targetCount = (limit && limit > 0)
        ? Math.min(limit, profile.stats.videos > 0 ? profile.stats.videos : limit)
        : (profile.stats.videos || 20);

      // 1. Intercept network responses for the user's post list ONLY
      page.on('response', async (res) => {
        const url = res.url();
        // Strictly listen to post/item_list (exclude preload, explore, feed, story)
        if (url.includes('post/item_list') && !url.includes('explore') && !url.includes('preload')) {
          try {
            if (res.headers()['content-type']?.includes('json')) {
              const data = await res.json();
              const items = data.itemList || data.aweme_list || [];
              if (Array.isArray(items)) {
                for (const item of items) {
                  if (videos.length >= targetCount) break;
                  // STRICT AUTHOR VALIDATION: Must belong to target profile (by author id or uniqueId)
                  const author = (item.author?.uniqueId || item.author?.unique_id || '').toLowerCase();
                  const authorId = String(item.author?.id || item.author?.uid || '');
                  const isAuthorMatch = (authorId && authorId === String(profile.profile_id)) || (author && author === targetUsername);
                  if (!isAuthorMatch) {
                    continue; // Skip videos from other authors
                  }
                  const vId = String(item.id || item.video_id || '');
                  if (vId && !seenVideoIds.has(vId)) {
                    seenVideoIds.add(vId);
                    const itemUrl = `https://www.tiktok.com/@${item.author?.uniqueId || profile.username}/video/${vId}`;
                    const normalized = normalizeVideoMetadata(item, itemUrl);
                    const videoRef: DiscoveredVideoReference = {
                      video_id: vId,
                      url: itemUrl,
                      published_at: normalized.published_at,
                      description: normalized.content.description,
                      normalized,
                    };
                    videos.push(videoRef);
                    onVideoDiscovered?.(videoRef, videos.length);
                  }
                }
              }
            }
          } catch {}
        }
      });

      const profileUrl = `https://www.tiktok.com/@${profile.username}`;
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Brief wait for initial TikTok client-side SSR hydration
      await page.waitForTimeout(1500);

      // Attempt to dismiss modal / captcha if present
      try {
        const closeBtn = await page.$('[data-e2e="modal-close-inner-button"], button[aria-label="Close"], [class*="close"]');
        if (closeBtn && await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(300);
        } else {
          await page.keyboard.press('Escape');
        }
      } catch {}

      // Fast check: If initial page load already satisfied targetCount, finish immediately!
      if (videos.length >= targetCount) {
        logger.stage('browser', `Initial load satisfied target limit (${videos.length}/${targetCount} videos). Finished.`);
        await page.close();
      } else {
        // Scroll to trigger remaining video loads with fast 600ms polling
        let scrolls = 0;
        let consecutiveNoNewVideos = 0;
        let prevCount = videos.length;
        const needed = Math.max(0, targetCount - videos.length);
        const maxScrolls = Math.max(8, Math.ceil(needed / 10) + 4);

        while (videos.length < targetCount && scrolls < maxScrolls) {
          scrolls++;
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(600);

          // Inspect DOM links strictly under this profile's username
          const domLinks = await page.$$eval('[data-e2e="user-post-item"] a, a[href*="/video/"]', els =>
            els.map(a => (a as HTMLAnchorElement).href || '')
          );

          for (const href of domLinks) {
            if (videos.length >= targetCount) break;
            // STRICT URL MATCHING: Must belong to target user
            const match = href.match(new RegExp(`/@${profile.username}/video/(\\d+)`, 'i'));
            if (match) {
              const vId = match[1];
              if (!seenVideoIds.has(vId)) {
                seenVideoIds.add(vId);
                const videoRef: DiscoveredVideoReference = {
                  video_id: vId,
                  url: href,
                };
                videos.push(videoRef);
                onVideoDiscovered?.(videoRef, videos.length);
              }
            }
          }

          if (videos.length >= targetCount) {
            break;
          }

          if (videos.length === prevCount) {
            consecutiveNoNewVideos++;
            if (consecutiveNoNewVideos >= 2) {
              break; // Reached bottom of profile feed
            }
          } else {
            consecutiveNoNewVideos = 0;
            prevCount = videos.length;
          }
        }

        await page.close();
      }

    } catch (err: any) {
      logger.warn(`Browser fallback encountered error: ${err.message}`);
      await page.close().catch(() => {});
    }

    const cookiesArr = await context.cookies().catch(() => []);
    const cookieStr = cookiesArr.map(c => `${c.name}=${c.value}`).join('; ');
    if (cookieStr) {
      for (const v of videos) {
        if (v.normalized) {
          v.normalized.cookies = cookieStr;
        }
      }
    }

    logger.stage('browser', `Browser discovery completed: ${videos.length} videos discovered`);

    return {
      profile_id: profile.profile_id,
      username: profile.username,
      fetched_at: new Date().toISOString(),
      total_discovered: videos.length,
      videos,
      method: 'browser_fallback',
    };
  }

  async getVideoMetadata(videoUrl: string): Promise<NormalizedTikTokVideo> {
    logger.stage('browser', `Executing browser fallback for video: ${videoUrl}`);
    const context = await this.getContext();
    const page = await context.newPage();

    try {
      await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      const content = await page.content();
      const cookiesArr = await context.cookies();
      const cookieStr = cookiesArr.map(c => `${c.name}=${c.value}`).join('; ');

      const rehydration = extractRehydrationData(content);
      if (!rehydration) {
        throw new Error('Rehydration data not found in browser page content');
      }

      const defaultScope = rehydration['__DEFAULT_SCOPE__'] || {};
      const videoDetail = defaultScope['webapp.video-detail'];

      if (!videoDetail || !videoDetail.itemInfo?.itemStruct) {
        const itemModule = rehydration.ItemModule;
        if (itemModule) {
          const firstId = Object.keys(itemModule)[0];
          if (firstId && itemModule[firstId]) {
            return normalizeVideoMetadata(itemModule[firstId], videoUrl, cookieStr);
          }
        }
        throw new Error('Video itemStruct not found in browser rehydration data');
      }

      const itemStruct = videoDetail.itemInfo.itemStruct;
      const normalized = normalizeVideoMetadata(itemStruct, videoUrl, cookieStr);
      logger.stage('browser', `Browser fallback acquired metadata for video ${normalized.video_id} by @${normalized.author.username}`);
      await page.close();
      return normalized;
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  }
}

export const browserFallback = new BrowserFallbackService();
