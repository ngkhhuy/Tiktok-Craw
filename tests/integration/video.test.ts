import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { resolveTikTokUrl } from '../../src/acquisition/tiktok/resolver.js';
import { videoCrawler } from '../../src/crawler/video-crawler.js';
import { localStorage } from '../../src/storage/local-storage.js';

describe('Video Pipeline Integration', () => {
  it('should resolve real TikTok short URLs via HTTP redirect', async () => {
    const shortUrl = 'https://vm.tiktok.com/ZMh5yU7G8/';
    const resolved = await resolveTikTokUrl(shortUrl);

    assert.equal(resolved.type, 'video');
    assert.ok(resolved.videoId);
    assert.ok(resolved.canonicalUrl);
    assert.match(resolved.canonicalUrl, /https:\/\/www\.tiktok\.com\//);
  });

  it('should crawl a public video and produce all required dataset files', async () => {
    const videoUrl = 'https://www.tiktok.com/@tiktok/video/7106594312292453675';
    const result = await videoCrawler.crawl(videoUrl, { refresh: false });

    assert.ok(result.status === 'completed' || result.status === 'skipped');
    assert.equal(result.videoId, '7106594312292453675');

    const videoDir = localStorage.getVideoDir('7106594312292453675');

    // 1. video.mp4
    const videoPath = path.join(videoDir, 'video.mp4');
    assert.ok(fs.existsSync(videoPath), 'video.mp4 must exist');
    assert.ok(fs.statSync(videoPath).size > 100000, 'video.mp4 must be non-empty');

    // 2. thumbnail.jpg
    const thumbPath = path.join(videoDir, 'thumbnail.jpg');
    assert.ok(fs.existsSync(thumbPath), 'thumbnail.jpg must exist');

    // 3. metadata.json
    const metaPath = path.join(videoDir, 'metadata.json');
    assert.ok(fs.existsSync(metaPath), 'metadata.json must exist');
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.equal(metadata.video_id, '7106594312292453675');
    assert.equal(metadata.source, 'tiktok');
    assert.ok(metadata.author.username);

    // 4. technical.json
    const techPath = path.join(videoDir, 'technical.json');
    assert.ok(fs.existsSync(techPath), 'technical.json must exist');
    const tech = JSON.parse(fs.readFileSync(techPath, 'utf-8'));
    assert.ok(tech.duration > 0, 'duration must be positive');
    assert.ok(tech.width > 0, 'width must be positive');
    assert.ok(tech.height > 0, 'height must be positive');
    assert.ok(tech.fps > 0, 'fps must be positive');

    // 5. comments.json
    const comPath = path.join(videoDir, 'comments.json');
    assert.ok(fs.existsSync(comPath), 'comments.json must exist');
    const com = JSON.parse(fs.readFileSync(comPath, 'utf-8'));
    assert.ok(com.status === 'completed' || com.status === 'unavailable');

    // 6. manifest.json
    const manifestPath = path.join(videoDir, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifest.status, 'completed');
    assert.ok(manifest.hash?.value, 'SHA-256 hash must be recorded in manifest');
  });
});
