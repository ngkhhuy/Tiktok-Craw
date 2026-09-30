import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { tiktokAcquisition } from '../acquisition/tiktok/index.js';
import { profileCrawler } from '../crawler/profile-crawler.js';
import { videoCrawler } from '../crawler/video-crawler.js';

export interface CrawlJob {
  id: string;
  input: string;
  type: 'profile' | 'video';
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startTime: string;
  endTime?: string;
  profile?: {
    profileId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    stats: {
      followers: number;
      likes: number;
      videos: number;
      views: number;
      following: number;
    };
  };
  progress: {
    stage: string;
    message: string;
    current: number;
    total: number;
    currentVideoId?: string;
    currentVideoTitle?: string;
    completedVideos: string[];
    viewsAccumulated: number;
  };
  error?: string;
  abortController?: AbortController;
}

export const activeJobs = new Map<string, CrawlJob>();

export function getProfileViews(profileId: string): number {
  let total = 0;
  const pVideosDir = path.join(config.dataDir, 'profiles', profileId, 'videos');
  if (fs.existsSync(pVideosDir)) {
    const entries = fs.readdirSync(pVideosDir);
    for (const vId of entries) {
      const metaPath = path.join(pVideosDir, vId, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          total += Number(meta.engagement?.views || 0);
        } catch {}
      }
    }
  }
  if (total === 0) {
    const videosJsonPath = path.join(config.dataDir, 'profiles', profileId, 'videos.json');
    if (fs.existsSync(videosJsonPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(videosJsonPath, 'utf-8'));
        const vList = data.videos || [];
        for (const item of vList) {
          total += Number(item.normalized?.engagement?.views || 0);
        }
      } catch {}
    }
  }
  return total;
}

function parseRequestBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

interface VideoItemSummary {
  videoId: string;
  profileId?: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  description: string;
  publishedAt: string | null;
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  fileSize: number;
  views: number;
  likes: number;
  commentsCount: number;
  sha256?: string;
  directory: string;
}

export function scanAllVideos(): { items: VideoItemSummary[]; totalSize: number; totalComments: number } {
  const baseDataDir = config.dataDir;
  const items: VideoItemSummary[] = [];
  let totalSize = 0;
  let totalComments = 0;

  // 1. Single videos directory: data/videos/<VIDEO_ID>
  const singleVideosDir = path.join(baseDataDir, 'videos');
  if (fs.existsSync(singleVideosDir)) {
    const entries = fs.readdirSync(singleVideosDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const item = loadVideoItem(path.join(singleVideosDir, entry.name), entry.name);
        if (item) {
          items.push(item);
          totalSize += item.fileSize;
          totalComments += item.commentsCount;
        }
      }
    }
  }

  // 2. Profile videos directory: data/profiles/<PROFILE_ID>/videos/<VIDEO_ID>
  const profilesDir = path.join(baseDataDir, 'profiles');
  if (fs.existsSync(profilesDir)) {
    const profileEntries = fs.readdirSync(profilesDir, { withFileTypes: true });
    for (const pEntry of profileEntries) {
      if (pEntry.isDirectory()) {
        const pVideosDir = path.join(profilesDir, pEntry.name, 'videos');
        if (fs.existsSync(pVideosDir)) {
          const vEntries = fs.readdirSync(pVideosDir, { withFileTypes: true });
          for (const vEntry of vEntries) {
            if (vEntry.isDirectory()) {
              const item = loadVideoItem(path.join(pVideosDir, vEntry.name), vEntry.name, pEntry.name);
              if (item) {
                items.push(item);
                totalSize += item.fileSize;
                totalComments += item.commentsCount;
              }
            }
          }
        }
      }
    }
  }

  // Sort descending by publication date or video ID
  items.sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    }
    return b.videoId.localeCompare(a.videoId);
  });

  return { items, totalSize, totalComments };
}

function loadVideoItem(dirPath: string, videoId: string, profileId?: string): VideoItemSummary | null {
  const metaPath = path.join(dirPath, 'metadata.json');
  const techPath = path.join(dirPath, 'technical.json');
  const manifestPath = path.join(dirPath, 'manifest.json');
  const videoFilePath = path.join(dirPath, 'video.mp4');

  if (!fs.existsSync(metaPath)) return null;

  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    let technical: any = {};
    if (fs.existsSync(techPath)) {
      try {
        technical = JSON.parse(fs.readFileSync(techPath, 'utf-8'));
      } catch {}
    }

    let manifest: any = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {}
    }

    const fileSize = fs.existsSync(videoFilePath) ? fs.statSync(videoFilePath).size : (technical.file_size || 0);

    return {
      videoId,
      profileId,
      username: metadata.author?.username || 'unknown',
      displayName: metadata.author?.display_name || metadata.author?.username || '',
      avatarUrl: metadata.author?.avatar_url || '',
      description: metadata.content?.description || '',
      publishedAt: metadata.published_at || null,
      videoUrl: `/media/stream/${videoId}?profileId=${profileId || ''}`,
      thumbnailUrl: `/media/thumb/${videoId}?profileId=${profileId || ''}`,
      duration: technical.duration || metadata.media?.duration || 0,
      width: technical.width || metadata.media?.width || 0,
      height: technical.height || metadata.media?.height || 0,
      fps: technical.fps || 30,
      videoCodec: technical.video_codec || 'h264',
      fileSize,
      views: metadata.engagement?.views || 0,
      likes: metadata.engagement?.likes || 0,
      commentsCount: metadata.engagement?.comments || 0,
      sha256: manifest.hash?.value,
      directory: dirPath,
    };
  } catch {
    return null;
  }
}

export function findVideoDir(videoId: string, profileId?: string): string | null {
  const baseDataDir = config.dataDir;
  if (profileId) {
    const pPath = path.join(baseDataDir, 'profiles', profileId, 'videos', videoId);
    if (fs.existsSync(pPath)) return pPath;
  }

  const sPath = path.join(baseDataDir, 'videos', videoId);
  if (fs.existsSync(sPath)) return sPath;

  // Search in all profiles
  const profilesDir = path.join(baseDataDir, 'profiles');
  if (fs.existsSync(profilesDir)) {
    const pEntries = fs.readdirSync(profilesDir);
    for (const p of pEntries) {
      const candidate = path.join(profilesDir, p, 'videos', videoId);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

export function createServer(port: number = 3000) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 0. API: /api/resolve (Instant Preview for User Link or Video Link)
    if (req.method === 'POST' && pathname === '/api/resolve') {
      try {
        const body = await parseRequestBody(req);
        const input = String(body.input || '').trim();
        if (!input) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Vui lòng nhập link profile hoặc video TikTok' }));
          return;
        }

        const isVideoUrl = /tiktok\.com\/.*\/video\/\d+/i.test(input) || /v[mt]\.tiktok\.com\//i.test(input);

        if (isVideoUrl) {
          const parsed = await tiktokAcquisition.parseAndResolveUrl(input);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            type: 'video',
            videoId: parsed.videoId,
            username: parsed.username,
            canonicalUrl: parsed.canonicalUrl || parsed.rawUrl,
          }));
          return;
        }

        // Profile resolution
        let username = input;
        if (username.startsWith('http://') || username.startsWith('https://')) {
          const uMatch = username.match(/@([a-zA-Z0-9_.-]+)/);
          if (uMatch) username = uMatch[1];
        }
        if (username.startsWith('@')) {
          username = username.slice(1);
        }
        username = username.split('/')[0].split('?')[0];

        const profile = await tiktokAcquisition.getProfile(username);
        const profileId = profile.profile_id;
        const existingViews = getProfileViews(profileId);

        const pVideosDir = path.join(config.dataDir, 'profiles', profileId, 'videos');
        const existingCount = fs.existsSync(pVideosDir)
          ? fs.readdirSync(pVideosDir).filter(f => fs.statSync(path.join(pVideosDir, f)).isDirectory()).length
          : 0;

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          type: 'profile',
          profile: {
            profileId,
            username: profile.username,
            displayName: profile.display_name || profile.username,
            avatarUrl: profile.avatar_url,
            bio: profile.bio,
            profileUrl: profile.profile_url,
            stats: {
              followers: profile.stats.followers,
              likes: profile.stats.likes,
              videos: profile.stats.videos,
              views: existingViews,
              following: profile.stats.following,
            },
            existingVideosCount: existingCount,
          }
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message || 'Không thể tìm thấy thông tin kênh TikTok' }));
      }
      return;
    }

    // 0.1 API: /api/crawl (Start background crawl)
    if (req.method === 'POST' && pathname === '/api/crawl') {
      try {
        const body = await parseRequestBody(req);
        const input = String(body.input || '').trim();
        const limit = Number(body.limit || 0) || undefined;

        if (!input) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Input is required' }));
          return;
        }

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const isVideoUrl = /tiktok\.com\/.*\/video\/\d+/i.test(input) || /v[mt]\.tiktok\.com\//i.test(input);
        const abortController = new AbortController();

        const job: CrawlJob = {
          id: jobId,
          input,
          type: isVideoUrl ? 'video' : 'profile',
          status: 'running',
          startTime: new Date().toISOString(),
          progress: {
            stage: 'init',
            message: 'Bắt đầu khởi tạo tiến trình...',
            current: 0,
            total: 0,
            completedVideos: [],
            viewsAccumulated: 0,
          },
          abortController,
        };

        activeJobs.set(jobId, job);

        // Async execution
        (async () => {
          try {
            if (job.type === 'profile') {
              let cleanUsername = input;
              if (cleanUsername.startsWith('http')) {
                const m = cleanUsername.match(/@([a-zA-Z0-9_.-]+)/);
                if (m) cleanUsername = m[1];
              }
              if (cleanUsername.startsWith('@')) cleanUsername = cleanUsername.slice(1);
              cleanUsername = cleanUsername.split('/')[0].split('?')[0];

              const pUrl = `https://www.tiktok.com/@${cleanUsername}`;

              await profileCrawler.crawl(pUrl, {
                limit: limit || 1000,
                signal: abortController.signal,
                onProgress: (evt) => {
                  if (job.status === 'stopped') return;
                  job.progress.stage = evt.stage;
                  if (evt.total !== undefined) job.progress.total = evt.total;
                  if (evt.current !== undefined) job.progress.current = evt.current;
                  if (evt.videoId) job.progress.currentVideoId = evt.videoId;
                  if (evt.videoTitle) job.progress.currentVideoTitle = evt.videoTitle;
                  if (evt.status === 'completed' && evt.videoId) {
                    if (!job.progress.completedVideos.includes(evt.videoId)) {
                      job.progress.completedVideos.push(evt.videoId);
                    }
                  }
                  if (evt.views) {
                    job.progress.viewsAccumulated += evt.views;
                  }
                  job.progress.message = evt.stage === 'resolving'
                    ? 'Đang phân giải hồ sơ TikTok...'
                    : evt.stage === 'discovering'
                    ? `Đang khám phá danh sách video của @${cleanUsername}...`
                    : evt.stage === 'downloading'
                    ? `Đang tải video [${job.progress.current}/${job.progress.total}]: ${evt.videoTitle || evt.videoId || ''}`
                    : evt.stage === 'completed'
                    ? `✓ Hoàn tất trích xuất! Đã tải ${job.progress.completedVideos.length} video.`
                    : 'Đang xử lý...';
                }
              });

              job.status = abortController.signal.aborted ? 'stopped' : 'completed';
              job.endTime = new Date().toISOString();
            } else {
              job.progress.stage = 'downloading';
              job.progress.total = 1;
              job.progress.message = 'Đang trích xuất dữ liệu video...';

              const res = await videoCrawler.crawl(input);
              if (res.status === 'completed') {
                job.progress.current = 1;
                job.progress.completedVideos.push(res.videoId);
                job.progress.message = '✓ Video đã được trích xuất thành công!';
                job.status = 'completed';
              } else {
                job.status = 'failed';
                job.error = res.error || 'Video acquisition failed';
              }
              job.endTime = new Date().toISOString();
            }
          } catch (err: any) {
            job.status = 'failed';
            job.error = err.message || 'Crawl error';
            job.endTime = new Date().toISOString();
          }
        })();

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, jobId, type: job.type }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message || 'Internal error' }));
      }
      return;
    }

    // 0.2 API: /api/crawl/status/:jobId
    if (pathname.startsWith('/api/crawl/status/')) {
      const jobId = pathname.slice('/api/crawl/status/'.length);
      const job = activeJobs.get(jobId);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Job not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        error: job.error,
        startTime: job.startTime,
        endTime: job.endTime,
      }));
      return;
    }

    // 0.3 API: /api/crawl/stop/:jobId
    if (req.method === 'POST' && pathname.startsWith('/api/crawl/stop/')) {
      const jobId = pathname.slice('/api/crawl/stop/'.length);
      const job = activeJobs.get(jobId);
      if (job) {
        job.abortController?.abort();
        job.status = 'stopped';
        job.progress.message = 'Tiến trình đã được dừng bởi người dùng.';
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 1. API: /api/videos
    if (pathname === '/api/videos') {
      const { items, totalSize, totalComments } = scanAllVideos();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ videos: items, totalCount: items.length, totalSize, totalComments }));
      return;
    }

    // 2. API: /api/videos/:id
    if (pathname.startsWith('/api/videos/')) {
      const videoId = pathname.slice('/api/videos/'.length).split('/')[0];
      const profileId = parsedUrl.searchParams.get('profileId') || undefined;
      const dirPath = findVideoDir(videoId, profileId);

      if (!dirPath) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Video not found' }));
        return;
      }

      const metaFile = path.join(dirPath, 'metadata.json');
      const techFile = path.join(dirPath, 'technical.json');
      const comFile = path.join(dirPath, 'comments.json');
      const manFile = path.join(dirPath, 'manifest.json');

      const metadata = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf-8')) : null;
      const technical = fs.existsSync(techFile) ? JSON.parse(fs.readFileSync(techFile, 'utf-8')) : null;
      const comments = fs.existsSync(comFile) ? JSON.parse(fs.readFileSync(comFile, 'utf-8')) : null;
      const manifest = fs.existsSync(manFile) ? JSON.parse(fs.readFileSync(manFile, 'utf-8')) : null;

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ metadata, technical, comments, manifest }));
      return;
    }

    // 3. Media: /media/thumb/:id
    if (pathname.startsWith('/media/thumb/')) {
      const videoId = pathname.slice('/media/thumb/'.length).split('/')[0];
      const profileId = parsedUrl.searchParams.get('profileId') || undefined;
      const dirPath = findVideoDir(videoId, profileId);

      if (!dirPath) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const thumbPath = path.join(dirPath, 'thumbnail.jpg');
      if (fs.existsSync(thumbPath)) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(thumbPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Thumbnail not found');
      }
      return;
    }

    // 4. Media: /media/stream/:id (HTTP 206 Partial Content Range support)
    if (pathname.startsWith('/media/stream/')) {
      const videoId = pathname.slice('/media/stream/'.length).split('/')[0];
      const profileId = parsedUrl.searchParams.get('profileId') || undefined;
      const dirPath = findVideoDir(videoId, profileId);

      if (!dirPath) {
        res.writeHead(404);
        res.end('Video not found');
        return;
      }

      const videoFilePath = path.join(dirPath, 'video.mp4');
      if (!fs.existsSync(videoFilePath)) {
        res.writeHead(404);
        res.end('video.mp4 does not exist');
        return;
      }

      const stat = fs.statSync(videoFilePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const fileStream = fs.createReadStream(videoFilePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        });
        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(videoFilePath).pipe(res);
      }
      return;
    }

    // 5. Static Files: public/
    let filePath = path.join(process.cwd(), 'public', pathname === '/' ? 'index.html' : pathname);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Default fallback to index.html
    const indexHtml = path.join(process.cwd(), 'public', 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexHtml).pipe(res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`\n🚀 TikTok Dataset Dashboard running at: http://localhost:${port}`);
    console.log(`Press Ctrl+C to stop.\n`);
  });

  return server;
}

// Auto start if executed directly
const isDirectRun = process.argv[1] && /server[\\/]index\.(ts|js)$/.test(process.argv[1]);
if (isDirectRun) {
  const port = parseInt(process.env.PORT || '3000', 10);
  createServer(port);
}
