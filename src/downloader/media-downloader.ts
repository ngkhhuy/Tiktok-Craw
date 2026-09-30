import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { calculateFileSha256 } from './hash.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

export interface DownloadResult {
  outputPath: string;
  bytesDownloaded: number;
  sha256: string;
}

export class MediaDownloader {
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
          const res = await fetch(mediaUrl, { headers });

          if (!res.ok && res.status !== 206) {
            throw new Error(`Media download HTTP error: status ${res.status} ${res.statusText}`);
          }

          if (!res.body) {
            throw new Error('Response body is empty');
          }

          const fileStream = fs.createWriteStream(partPath);
          const nodeReadable = Readable.fromWeb(res.body as any);

          await pipeline(nodeReadable, fileStream);
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

      // Atomic rename: .part -> final file
      await fs.promises.rename(partPath, outputPath);
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
      const res = await fetch(thumbnailUrl, {
        headers: {
          'User-Agent': config.userAgentDesktop,
          'Referer': options.referer || 'https://www.tiktok.com/',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });

      if (!res.ok) {
        logger.warn(`Thumbnail download returned HTTP ${res.status}`);
        return false;
      }

      const fileStream = fs.createWriteStream(partPath);
      const nodeReadable = Readable.fromWeb(res.body as any);

      await pipeline(nodeReadable, fileStream);

      const stats = fs.statSync(partPath);
      if (stats.size === 0) {
        try { fs.unlinkSync(partPath); } catch {}
        return false;
      }

      await fs.promises.rename(partPath, outputPath);
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
