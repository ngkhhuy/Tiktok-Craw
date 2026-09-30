#!/usr/bin/env node
import { Command } from 'commander';
import { videoCrawler } from '../crawler/video-crawler.js';
import { profileCrawler } from '../crawler/profile-crawler.js';
import { tiktokAcquisition } from '../acquisition/tiktok/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

import { createServer } from '../server/index.js';

const program = new Command();

program
  .name('tiktok-crawler')
  .description('Standalone TikTok Video & Profile Ingestion Pipeline')
  .version('1.0.0');

program
  .command('video')
  .description('Crawl and ingest a single TikTok video')
  .argument('<url>', 'TikTok video URL or short URL')
  .option('--refresh', 'Refresh metadata without redownloading media if existing', false)
  .option('--refresh-comments', 'Only refresh comments for the video', false)
  .option('--force', 'Force re-download and re-process all artifacts', false)
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (url: string, opts: any) => {
    if (opts.verbose) {
      logger.setVerbose(true);
    }

    try {
      const result = await videoCrawler.crawl(url, {
        refresh: opts.refresh,
        refreshComments: opts.refreshComments,
        force: opts.force,
      });

      if (result.status === 'failed') {
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`CLI execution failed: ${err.message}`);
      process.exitCode = 1;
    } finally {
      await tiktokAcquisition.close();
    }
  });

program
  .command('profile')
  .description('Crawl and ingest a TikTok creator profile and its videos')
  .argument('<url>', 'TikTok profile URL (e.g. https://www.tiktok.com/@username)')
  .option('-l, --limit <number>', 'Maximum number of videos to crawl', (v) => parseInt(v, 10), 10)
  .option('-c, --concurrency <number>', 'Number of videos to process concurrently', (v) => parseInt(v, 10), config.videoConcurrency)
  .option('--refresh', 'Refresh metadata without redownloading media if existing', false)
  .option('--refresh-comments', 'Only refresh comments for existing videos', false)
  .option('--force', 'Force re-processing of all discovered videos', false)
  .option('--headless', 'Run browser fallback in headless mode', true)
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (url: string, opts: any) => {
    if (opts.verbose) {
      logger.setVerbose(true);
    }
    if (opts.headless !== undefined) {
      config.headless = opts.headless;
    }

    try {
      const manifest = await profileCrawler.crawl(url, {
        limit: opts.limit,
        concurrency: opts.concurrency,
        refresh: opts.refresh,
        refreshComments: opts.refreshComments,
        force: opts.force,
      });

      if (manifest?.status === 'failed') {
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`CLI execution failed: ${err.message}`);
      process.exitCode = 1;
    } finally {
      await tiktokAcquisition.close();
    }
  });

program
  .command('ui')
  .description('Launch the TikTok Dataset Explorer Web UI')
  .option('-p, --port <number>', 'Server port', (v) => parseInt(v, 10), 3000)
  .action((opts: any) => {
    createServer(opts.port);
  });

program.parseAsync(process.argv);
