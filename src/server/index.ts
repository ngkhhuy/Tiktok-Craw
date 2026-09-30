import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { tiktokAcquisition } from '../acquisition/tiktok/index.js';
import { profileCrawler } from '../crawler/profile-crawler.js';
import { videoCrawler } from '../crawler/video-crawler.js';
import { localStorage } from '../storage/local-storage.js';
import { queryVideos, getVideoById, getVideoStats, rebuildIndex } from '../storage/database.js';
import { ragService } from '../rag/rag-service.js';
import { conversationManager } from '../conversation/conversation-manager.js';
import { getPopulationBaseline } from '../analytics/baseline.js';

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
    skippedVideos: string[];
    failedVideos: string[];
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

export function scanAllVideos(options: {
  page?: number;
  limit?: number;
  sort?: 'newest' | 'oldest' | 'views' | 'likes' | 'size';
  search?: string;
  profileId?: string;
} = {}): {
  items: VideoItemSummary[];
  totalCount: number;
  totalSize: number;
  totalComments: number;
  page: number;
  totalPages: number;
} {
  const result = queryVideos({
    page: options.page || 1,
    limit: options.limit || 100,
    sort: options.sort,
    search: options.search,
    profileId: options.profileId,
  });

  const items: VideoItemSummary[] = result.videos.map((v) => ({
    videoId: v.video_id,
    profileId: v.profile_id || undefined,
    username: v.username || 'unknown',
    displayName: v.display_name || v.username || '',
    avatarUrl: v.avatar_url || '',
    description: v.description || '',
    publishedAt: v.published_at || null,
    videoUrl: `/media/stream/${v.video_id}?profileId=${v.profile_id || ''}`,
    thumbnailUrl: `/media/thumb/${v.video_id}?profileId=${v.profile_id || ''}`,
    duration: v.duration || 0,
    width: v.width || 0,
    height: v.height || 0,
    fps: v.fps || 30,
    videoCodec: v.video_codec || 'h264',
    fileSize: v.file_size || 0,
    views: v.views || 0,
    likes: v.likes || 0,
    commentsCount: v.comments_count || 0,
    sha256: v.sha256,
    directory: v.directory,
  }));

  return {
    items,
    totalCount: result.total,
    totalSize: result.totalSize,
    totalComments: result.totalComments,
    page: result.page,
    totalPages: result.totalPages,
  };
}

export function findVideoDir(videoId: string, profileId?: string): string | null {
  // 1. Fast SQLite lookup
  try {
    const record = getVideoById(videoId);
    if (record?.directory && fs.existsSync(record.directory)) {
      return record.directory;
    }
  } catch {}

  // 2. Storage resolver (checks sharded + legacy paths)
  return localStorage.findVideoDir(videoId, profileId);
}

export function createServer(port: number = 3000) {
  // Ensure database index is initialized from disk if empty
  try {
    const stats = getVideoStats();
    if (stats.total === 0) {
      console.log('[INDEX] SQLite index is empty, rebuilding from disk...');
      rebuildIndex();
    }
  } catch (err: any) {
    console.warn('[INDEX] Note on DB initialization:', err.message);
  }

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

    // 0.05 API: /api/system-info (Hardware specs and concurrency defaults)
    if (req.method === 'GET' && pathname === '/api/system-info') {
      const cpus = os.cpus();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        cpuModel: cpus[0]?.model || 'Generic CPU',
        cpuCores: cpus.length || 16,
        defaultConcurrency: config.videoConcurrency,
      }));
      return;
    }

    // 0.1 API: /api/crawl (Start background crawl)
    if (req.method === 'POST' && pathname === '/api/crawl') {
      try {
        const body = await parseRequestBody(req);
        const input = String(body.input || '').trim();
        const limit = Number(body.limit || 0) || undefined;
        const concurrency = Number(body.concurrency || 0) || config.videoConcurrency;

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
            skippedVideos: [],
            failedVideos: [],
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
                concurrency,
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
                  } else if (evt.status === 'skipped' && evt.videoId) {
                    if (!job.progress.skippedVideos.includes(evt.videoId)) {
                      job.progress.skippedVideos.push(evt.videoId);
                    }
                  } else if (evt.status === 'failed' && evt.videoId) {
                    if (!job.progress.failedVideos.includes(evt.videoId)) {
                      job.progress.failedVideos.push(evt.videoId);
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
                    ? (job.progress.completedVideos.length === 0 && job.progress.skippedVideos.length > 0
                        ? `✓ Hoàn tất! Toàn bộ ${job.progress.skippedVideos.length} video đã có sẵn trên máy (bỏ qua tải lại).`
                        : job.progress.completedVideos.length === 0 && (job.progress.total === 0 || job.progress.skippedVideos.length === 0)
                        ? `⚠️ Không tìm thấy video nào khả dụng trên kênh @${cleanUsername}.`
                        : `✓ Hoàn tất trích xuất! Đã tải mới ${job.progress.completedVideos.length} video${job.progress.skippedVideos.length > 0 ? ` (${job.progress.skippedVideos.length} video đã có sẵn)` : ''}.`)
                    : evt.stage === 'interrupted'
                    ? `⏹ Tiến trình cào đã dừng. Đã tải ${job.progress.completedVideos.length} video.`
                    : 'Đang xử lý...';
                }
              });

              const isStopped = abortController.signal.aborted || job.progress.stage === 'interrupted';
              job.status = isStopped ? 'stopped' : 'completed';
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

    // 1. API: /api/videos (with SQLite pagination, sorting, filtering)
    if (pathname === '/api/videos') {
      const page = parsedUrl.searchParams.get('page') ? parseInt(parsedUrl.searchParams.get('page')!, 10) : undefined;
      const limit = parsedUrl.searchParams.get('limit') ? parseInt(parsedUrl.searchParams.get('limit')!, 10) : undefined;
      const sort = (parsedUrl.searchParams.get('sort') || undefined) as any;
      const search = parsedUrl.searchParams.get('search') || undefined;
      const profileId = parsedUrl.searchParams.get('profileId') || undefined;

      const { items, totalCount, totalSize, totalComments, page: curPage, totalPages } = scanAllVideos({
        page,
        limit,
        sort,
        search,
        profileId,
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        videos: items,
        totalCount,
        totalSize,
        totalComments,
        page: curPage,
        totalPages,
      }));
      return;
    }

    // 1.1 API: /api/rebuild-index
    if (req.method === 'POST' && pathname === '/api/rebuild-index') {
      try {
        const stats = rebuildIndex();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, ...stats }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 1.2 API: /api/stats
    if (pathname === '/api/stats') {
      const stats = getVideoStats();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(stats));
      return;
    }

    // 1.3 API: /api/rag/query
    if (req.method === 'POST' && pathname === '/api/rag/query') {
      try {
        const body = await parseRequestBody(req);
        const question = String(body.question || '').trim();
        const sessionId = body.sessionId ? String(body.sessionId).trim() : undefined;

        if (!question) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Câu hỏi không được để trống' }));
          return;
        }

        const result = await ragService.query(question, sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        logger.error(`[RAG] Error processing query: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 1.4 API: /api/rag/sessions/:id
    if (pathname.startsWith('/api/rag/sessions/')) {
      const sessId = pathname.slice('/api/rag/sessions/'.length).split('/')[0];
      if (req.method === 'DELETE') {
        conversationManager.clearSession(sessId);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: 'Session cleared' }));
        return;
      }
      const session = conversationManager.getOrCreateSession(sessId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(session));
      return;
    }

    // 1.5 API: /api/analytics/baseline
    if (pathname === '/api/analytics/baseline') {
      const population = (parsedUrl.searchParams.get('population') || 'all_videos') as any;
      const baseline = getPopulationBaseline(population);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(baseline));
      return;
    }

    // 1.6 API: /api/rag/config (Get/Set AI API configurations)
    if (pathname === '/api/rag/config') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          llmApiKeyMasked: config.llmApiKey ? config.llmApiKey.slice(0, 4) + '...' + config.llmApiKey.slice(-4) : '',
          hasLlmApiKey: Boolean(config.llmApiKey),
          llmBaseUrl: config.llmBaseUrl,
          llmModel: config.llmModel,
          embeddingApiKeyMasked: config.embeddingApiKey ? config.embeddingApiKey.slice(0, 4) + '...' + config.embeddingApiKey.slice(-4) : '',
          hasEmbeddingApiKey: Boolean(config.embeddingApiKey),
          embeddingBaseUrl: config.embeddingBaseUrl,
          embeddingModel: config.embeddingModel,
          ragDebug: config.ragDebug,
        }));
        return;
      }
      if (req.method === 'POST') {
        try {
          const body = await parseRequestBody(req);
          const envUpdates: Record<string, string> = {};

          if (body.llmApiKey !== undefined) {
            config.llmApiKey = String(body.llmApiKey).trim();
            envUpdates['LLM_API_KEY'] = config.llmApiKey;
          }
          if (body.llmBaseUrl !== undefined) {
            config.llmBaseUrl = String(body.llmBaseUrl).trim();
            envUpdates['LLM_BASE_URL'] = config.llmBaseUrl;
          }
          if (body.llmModel !== undefined) {
            config.llmModel = String(body.llmModel).trim();
            envUpdates['LLM_MODEL'] = config.llmModel;
          }
          if (body.embeddingApiKey !== undefined) {
            config.embeddingApiKey = String(body.embeddingApiKey).trim();
            envUpdates['EMBEDDING_API_KEY'] = config.embeddingApiKey;
          }
          if (body.embeddingBaseUrl !== undefined) {
            config.embeddingBaseUrl = String(body.embeddingBaseUrl).trim();
            envUpdates['EMBEDDING_BASE_URL'] = config.embeddingBaseUrl;
          }
          if (body.embeddingModel !== undefined) {
            config.embeddingModel = String(body.embeddingModel).trim();
            envUpdates['EMBEDDING_MODEL'] = config.embeddingModel;
          }

          // Persist to .env
          const envPath = path.resolve(process.cwd(), '.env');
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf-8');
            for (const [k, v] of Object.entries(envUpdates)) {
              const regex = new RegExp(`^${k}=.*$`, 'm');
              if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${k}=${v}`);
              } else {
                envContent += `\n${k}=${v}`;
              }
            }
            fs.writeFileSync(envPath, envContent, 'utf-8');
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            message: 'Cấu hình AI đã được lưu thành công vào .env và áp dụng ngay lập tức!',
            current: {
              llmModel: config.llmModel,
              llmBaseUrl: config.llmBaseUrl,
              hasLlmApiKey: Boolean(config.llmApiKey),
            }
          }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }
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
