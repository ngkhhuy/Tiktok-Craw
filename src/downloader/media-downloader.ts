import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { calculateFileSha256 } from './hash.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { RateLimiter } from '../utils/rate-limiter.js';

export interface DownloadResult {
  outputPath: string;
  bytesDownloaded: number;
  sha256: string;
}

async function safeRename(source: string, destination: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (err: any) {
      if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 4) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
      } else if (attempt === 4) {
        try {
          await fs.promises.copyFile(source, destination);
          await fs.promises.unlink(source).catch(() => {});
          return;
        } catch {}
        throw err;
      } else {
        throw err;
      }
    }
  }
}

export class MediaDownloader {
  private readonly rateLimiter = new RateLimiter(config.mediaRequestDelayMs);

  /**
   * Streams a response while enforcing a timeout only when data stops moving.
   * A total-request timeout is a poor fit for large videos: it kills healthy
   * slow downloads, while a stalled socket can otherwise hold a worker slot
   * for several retries.
   */
  private async fetchToFile(
    url: string,
    outputPath: string,
    headers: Record<string, string>,
    label: string
  ): Promise<void> {
    await this.rateLimiter.acquire();

    const controller = new AbortController();
    let source: Readable | undefined;
    let destination: fs.WriteStream | undefined;
    let stallTimer: NodeJS.Timeout | undefined;
    let stalled = false;

    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        const error = new Error(`${label} made no progress for ${config.mediaStallTimeoutMs}ms`);
        controller.abort(error);
        source?.destroy(error);
        destination?.destroy(error);
      }, config.mediaStallTimeoutMs);
    };

    try {
      armStallTimer();
      const res = await fetch(url, { headers, signal: controller.signal });

      if (!res.ok && res.status !== 206) {
        throw new Error(`${label} HTTP error: status ${res.status} ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error(`${label} response body is empty`);
      }

      source = Readable.fromWeb(res.body as any);
      destination = fs.createWriteStream(outputPath);
      source.on('data', armStallTimer);
      await pipeline(source, destination);
    } catch (err: any) {
      if (stalled) {
        throw new Error(`${label} stalled after ${config.mediaStallTimeoutMs}ms without data`);
      }
      throw err;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }
  }

  async downloadVideo(
    mediaUrl: string,
    outputPath: string,
    options: { cookies?: string; referer?: string } = {}
  ): Promise<DownloadResult> {
    const partPath = `${outputPath}.part`;

    logger.stage('video', `Starting streaming download to ${partPath}`);

    // Ensure parent directory exists
    const dir = outputPath.substring(0, outputPath.lastIndexOf(/[/\\]/.exec(outputPath)?.[0] || '/'));
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Clean up any stale .part file from previous crashed run
    if (fs.existsSync(partPath)) {
      try {
        fs.unlinkSync(partPath);
      } catch {}
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': config.userAgentDesktop,
        'Referer': options.referer || 'https://www.tiktok.com/',
        'Accept': '*/*',
        'Accept-Encoding': 'identity;q=1, *;q=0',
      };

      if (options.cookies) {
        headers['Cookie'] = options.cookies;
      }

      await withRetry(
        async () => {
          // Every retry starts from a clean partial file. Resume is deliberately
          // not attempted here because the current TikTok CDN URLs are ephemeral.
          await fs.promises.rm(partPath, { force: true }).catch(() => {});
          await this.fetchToFile(mediaUrl, partPath, headers, 'Media download');
        },
        {
          maxRetries: config.maxRetries,
          initialDelayMs: 1000,
          timeoutMs: config.requestTimeoutMs,
        }
      );

      // Validate downloaded file
      if (!fs.existsSync(partPath)) {
        throw new Error('Downloaded partial file does not exist');
      }

      const stats = fs.statSync(partPath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty (0 bytes)');
      }

      // Calculate SHA-256
      const sha256 = await calculateFileSha256(partPath);

      // Atomic rename: .part -> final file with Windows lock retry
      await safeRename(partPath, outputPath);
      logger.stage('video', `Download complete: ${stats.size} bytes, SHA-256: ${sha256}`);

      return {
        outputPath,
        bytesDownloaded: stats.size,
        sha256,
      };
    } catch (err: any) {
      // Remove partial file on error to prevent corrupted files
      if (fs.existsSync(partPath)) {
        try {
          fs.unlinkSync(partPath);
        } catch {}
      }
      throw err;
    }
  }

  async downloadThumbnail(
    thumbnailUrl: string,
    outputPath: string,
    options: { referer?: string } = {}
  ): Promise<boolean> {
    logger.stage('thumbnail', `Downloading thumbnail to ${outputPath}`);

    const partPath = `${outputPath}.part`;

    const dir = outputPath.substring(0, outputPath.lastIndexOf(/[/\\]/.exec(outputPath)?.[0] || '/'));
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      await fs.promises.rm(partPath, { force: true }).catch(() => {});
      await this.fetchToFile(
        thumbnailUrl,
        partPath,
        {
          'User-Agent': config.userAgentDesktop,
          'Referer': options.referer || 'https://www.tiktok.com/',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        'Thumbnail download'
      );

      const stats = fs.statSync(partPath);
      if (stats.size === 0) {
        try { fs.unlinkSync(partPath); } catch {}
        return false;
      }

      await safeRename(partPath, outputPath);
      logger.stage('thumbnail', `Thumbnail downloaded: ${stats.size} bytes`);
      return true;
    } catch (err: any) {
      if (fs.existsSync(partPath)) {
        try { fs.unlinkSync(partPath); } catch {}
      }
      logger.warn(`Failed to download thumbnail: ${err.message}`);
      return false;
    }
  }
}

export const mediaDownloader = new MediaDownloader();
