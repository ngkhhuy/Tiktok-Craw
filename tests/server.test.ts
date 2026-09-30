import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { createServer } from '../src/server/index.js';

describe('TikTok Dataset Server API & Static Tests', () => {
  let server: http.Server;
  const PORT = 3099;
  const BASE_URL = `http://localhost:${PORT}`;

  before(async () => {
    server = createServer(PORT);
    // Allow brief moment for listen
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  });

  it('should serve index.html at GET /', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.match(contentType || '', /text\/html/);
    const text = await res.text();
    assert.match(text, /TikTok Dataset Explorer/);
    assert.match(text, /videoGrid/);
  });

  it('should serve style.css at GET /style.css', async () => {
    const res = await fetch(`${BASE_URL}/style.css`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.match(contentType || '', /text\/css/);
    const text = await res.text();
    assert.match(text, /--accent-pink/);
  });

  it('should serve app.js at GET /app.js', async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.match(contentType || '', /javascript/);
    const text = await res.text();
    assert.match(text, /openDetailModal/);
  });

  it('should return videos list from GET /api/videos', async () => {
    const res = await fetch(`${BASE_URL}/api/videos`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.videos));
    assert.ok(data.totalCount > 0);
    assert.ok(data.totalSize > 0);
    assert.ok(data.totalComments > 0);

    const first = data.videos[0];
    assert.ok(first.videoId);
    assert.ok(first.videoUrl);
    assert.ok(first.thumbnailUrl);
    assert.ok(typeof first.duration === 'number');
  });

  it('should return full details from GET /api/videos/:id', async () => {
    const listRes = await fetch(`${BASE_URL}/api/videos`);
    const listData = await listRes.json();
    const testVideo = listData.videos[0];

    const detailRes = await fetch(`${BASE_URL}/api/videos/${testVideo.videoId}${testVideo.profileId ? `?profileId=${testVideo.profileId}` : ''}`);
    assert.strictEqual(detailRes.status, 200);
    const details = await detailRes.json();

    assert.ok(details.metadata);
    assert.strictEqual(details.metadata.video_id, testVideo.videoId);
    assert.ok(details.technical);
    assert.ok(details.technical.width > 0);
    assert.ok(details.manifest);
    assert.ok(details.manifest.hash?.value);
  });

  it('should stream video with HTTP 206 Range at GET /media/stream/:id', async () => {
    const listRes = await fetch(`${BASE_URL}/api/videos`);
    const listData = await listRes.json();
    const testVideo = listData.videos[0];

    const streamRes = await fetch(`${BASE_URL}${testVideo.videoUrl}`, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.strictEqual(streamRes.status, 206);
    assert.strictEqual(streamRes.headers.get('content-type'), 'video/mp4');
    assert.strictEqual(streamRes.headers.get('content-length'), '1024');
    assert.match(streamRes.headers.get('content-range') || '', /^bytes 0-1023\//);
  });

  it('should serve thumbnail image at GET /media/thumb/:id', async () => {
    const listRes = await fetch(`${BASE_URL}/api/videos`);
    const listData = await listRes.json();
    const testVideo = listData.videos[0];

    const thumbRes = await fetch(`${BASE_URL}${testVideo.thumbnailUrl}`);
    assert.strictEqual(thumbRes.status, 200);
    assert.strictEqual(thumbRes.headers.get('content-type'), 'image/jpeg');
  });
});
