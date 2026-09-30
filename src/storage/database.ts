import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config/index.js';

const DB_FILENAME = 'index.db';

let _db: Database.Database | null = null;

function getDbPath(): string {
  return path.join(config.dataDir, DB_FILENAME);
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('cache_size = -64000'); // 64 MB cache
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      video_id TEXT PRIMARY KEY,
      profile_id TEXT,
      username TEXT,
      display_name TEXT,
      avatar_url TEXT,
      description TEXT,
      published_at TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      duration REAL DEFAULT 0,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      fps REAL DEFAULT 0,
      video_codec TEXT,
      file_size INTEGER DEFAULT 0,
      sha256 TEXT,
      status TEXT DEFAULT 'pending',
      is_photo_mode INTEGER DEFAULT 0,
      directory TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      profile_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      bio TEXT,
      profile_url TEXT,
      followers INTEGER DEFAULT 0,
      following INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      videos_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      sec_uid TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_videos_profile ON videos(profile_id);
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_username ON videos(username);
    CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(views DESC);
    CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
  `);
}

// ─── Video CRUD ──────────────────────────────────────────────

export interface VideoRecord {
  video_id: string;
  profile_id?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  description?: string | null;
  published_at?: string | null;
  views?: number;
  likes?: number;
  comments_count?: number;
  shares?: number;
  saves?: number;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  video_codec?: string | null;
  file_size?: number;
  sha256?: string | null;
  status?: string | null;
  is_photo_mode?: boolean;
  directory: string;
}

export function upsertVideo(record: VideoRecord): void {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO videos (
      video_id, profile_id, username, display_name, avatar_url,
      description, published_at, views, likes, comments_count,
      shares, saves, duration, width, height, fps, video_codec,
      file_size, sha256, status, is_photo_mode, directory,
      created_at, updated_at
    ) VALUES (
      @video_id, @profile_id, @username, @display_name, @avatar_url,
      @description, @published_at, @views, @likes, @comments_count,
      @shares, @saves, @duration, @width, @height, @fps, @video_codec,
      @file_size, @sha256, @status, @is_photo_mode, @directory,
      @created_at, @updated_at
    )
    ON CONFLICT(video_id) DO UPDATE SET
      profile_id = COALESCE(@profile_id, profile_id),
      username = COALESCE(@username, username),
      display_name = COALESCE(@display_name, display_name),
      avatar_url = COALESCE(@avatar_url, avatar_url),
      description = COALESCE(@description, description),
      published_at = COALESCE(@published_at, published_at),
      views = CASE WHEN @views > 0 THEN @views ELSE views END,
      likes = CASE WHEN @likes > 0 THEN @likes ELSE likes END,
      comments_count = CASE WHEN @comments_count > 0 THEN @comments_count ELSE comments_count END,
      shares = CASE WHEN @shares > 0 THEN @shares ELSE shares END,
      saves = CASE WHEN @saves > 0 THEN @saves ELSE saves END,
      duration = CASE WHEN @duration > 0 THEN @duration ELSE duration END,
      width = CASE WHEN @width > 0 THEN @width ELSE width END,
      height = CASE WHEN @height > 0 THEN @height ELSE height END,
      fps = CASE WHEN @fps > 0 THEN @fps ELSE fps END,
      video_codec = COALESCE(@video_codec, video_codec),
      file_size = CASE WHEN @file_size > 0 THEN @file_size ELSE file_size END,
      sha256 = COALESCE(@sha256, sha256),
      status = COALESCE(@status, status),
      is_photo_mode = @is_photo_mode,
      directory = @directory,
      updated_at = @updated_at
  `);

  stmt.run({
    video_id: record.video_id,
    profile_id: record.profile_id || null,
    username: record.username || null,
    display_name: record.display_name || null,
    avatar_url: record.avatar_url || null,
    description: record.description || null,
    published_at: record.published_at || null,
    views: record.views || 0,
    likes: record.likes || 0,
    comments_count: record.comments_count || 0,
    shares: record.shares || 0,
    saves: record.saves || 0,
    duration: record.duration || 0,
    width: record.width || 0,
    height: record.height || 0,
    fps: record.fps || 0,
    video_codec: record.video_codec || null,
    file_size: record.file_size || 0,
    sha256: record.sha256 || null,
    status: record.status || 'pending',
    is_photo_mode: record.is_photo_mode ? 1 : 0,
    directory: record.directory,
    created_at: now,
    updated_at: now,
  });
}

// ─── Profile CRUD ────────────────────────────────────────────

export function upsertProfile(record: {
  profile_id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  profile_url?: string;
  followers?: number;
  following?: number;
  likes?: number;
  videos_count?: number;
  status?: string;
  sec_uid?: string;
}): void {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO profiles (
      profile_id, username, display_name, avatar_url, bio,
      profile_url, followers, following, likes, videos_count,
      status, sec_uid, created_at, updated_at
    ) VALUES (
      @profile_id, @username, @display_name, @avatar_url, @bio,
      @profile_url, @followers, @following, @likes, @videos_count,
      @status, @sec_uid, @created_at, @updated_at
    )
    ON CONFLICT(profile_id) DO UPDATE SET
      username = @username,
      display_name = COALESCE(@display_name, display_name),
      avatar_url = COALESCE(@avatar_url, avatar_url),
      bio = COALESCE(@bio, bio),
      profile_url = COALESCE(@profile_url, profile_url),
      followers = CASE WHEN @followers > 0 THEN @followers ELSE followers END,
      following = CASE WHEN @following >= 0 THEN @following ELSE following END,
      likes = CASE WHEN @likes > 0 THEN @likes ELSE likes END,
      videos_count = CASE WHEN @videos_count > 0 THEN @videos_count ELSE videos_count END,
      status = COALESCE(@status, status),
      sec_uid = COALESCE(@sec_uid, sec_uid),
      updated_at = @updated_at
  `);

  stmt.run({
    profile_id: record.profile_id,
    username: record.username,
    display_name: record.display_name || null,
    avatar_url: record.avatar_url || null,
    bio: record.bio || null,
    profile_url: record.profile_url || null,
    followers: record.followers || 0,
    following: record.following || 0,
    likes: record.likes || 0,
    videos_count: record.videos_count || 0,
    status: record.status || 'pending',
    sec_uid: record.sec_uid || null,
    created_at: now,
    updated_at: now,
  });
}

// ─── Query API ───────────────────────────────────────────────

export interface VideosQueryOptions {
  page?: number;
  limit?: number;
  sort?: 'newest' | 'oldest' | 'views' | 'likes' | 'size';
  search?: string;
  profileId?: string;
  status?: string;
}

export interface VideosQueryResult {
  videos: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  totalSize: number;
  totalComments: number;
  totalViews: number;
}

export function queryVideos(options: VideosQueryOptions = {}): VideosQueryResult {
  const db = getDb();
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(200, Math.max(1, options.limit || 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: Record<string, any> = {};

  // Default: only completed videos
  if (options.status) {
    conditions.push('status = @filterStatus');
    params.filterStatus = options.status;
  } else {
    conditions.push("status = 'completed'");
  }

  if (options.profileId) {
    conditions.push('profile_id = @filterProfileId');
    params.filterProfileId = options.profileId;
  }

  if (options.search) {
    conditions.push('(description LIKE @filterSearch OR username LIKE @filterSearch OR video_id LIKE @filterSearch)');
    params.filterSearch = `%${options.search}%`;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderClause = 'ORDER BY published_at DESC NULLS LAST, video_id DESC';
  switch (options.sort) {
    case 'oldest': orderClause = 'ORDER BY published_at ASC NULLS LAST, video_id ASC'; break;
    case 'views': orderClause = 'ORDER BY views DESC, video_id DESC'; break;
    case 'likes': orderClause = 'ORDER BY likes DESC, video_id DESC'; break;
    case 'size': orderClause = 'ORDER BY file_size DESC, video_id DESC'; break;
  }

  // Aggregates
  const countRow = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(file_size), 0) as totalSize,
      COALESCE(SUM(comments_count), 0) as totalComments,
      COALESCE(SUM(views), 0) as totalViews
    FROM videos ${whereClause}
  `).get(params) as any;

  const total = countRow?.total || 0;

  // Fetch page
  const videos = db.prepare(`
    SELECT * FROM videos ${whereClause} ${orderClause} LIMIT @pageLimit OFFSET @pageOffset
  `).all({ ...params, pageLimit: limit, pageOffset: offset });

  return {
    videos,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalSize: countRow?.totalSize || 0,
    totalComments: countRow?.totalComments || 0,
    totalViews: countRow?.totalViews || 0,
  };
}

export function getVideoById(videoId: string): any | null {
  const db = getDb();
  return db.prepare('SELECT * FROM videos WHERE video_id = ?').get(videoId) || null;
}

export function getVideoStats(): { total: number; totalSize: number; totalComments: number; totalViews: number } {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(file_size), 0) as totalSize,
      COALESCE(SUM(comments_count), 0) as totalComments,
      COALESCE(SUM(views), 0) as totalViews
    FROM videos WHERE status = 'completed'
  `).get() as any;

  return {
    total: row?.total || 0,
    totalSize: row?.totalSize || 0,
    totalComments: row?.totalComments || 0,
    totalViews: row?.totalViews || 0,
  };
}

// ─── Rebuild Index (scan existing files on disk) ─────────────

export function rebuildIndex(): { videosIndexed: number; profilesIndexed: number } {
  const db = getDb();
  const baseDataDir = config.dataDir;
  let videosIndexed = 0;
  let profilesIndexed = 0;

  console.log('[INDEX] Rebuilding SQLite index from disk...');

  // Helper: index one video directory
  function indexVideoDir(dirPath: string, videoId: string, profileId?: string): void {
    const metaPath = path.join(dirPath, 'metadata.json');
    if (!fs.existsSync(metaPath)) return;

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const techPath = path.join(dirPath, 'technical.json');
      let tech: any = {};
      if (fs.existsSync(techPath)) {
        try { tech = JSON.parse(fs.readFileSync(techPath, 'utf-8')); } catch {}
      }
      const manifestPath = path.join(dirPath, 'manifest.json');
      let manifest: any = {};
      if (fs.existsSync(manifestPath)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch {}
      }

      const videoFilePath = path.join(dirPath, 'video.mp4');
      const fileSize = fs.existsSync(videoFilePath) ? fs.statSync(videoFilePath).size : 0;

      upsertVideo({
        video_id: videoId,
        profile_id: profileId || null,
        username: meta.author?.username || '',
        display_name: meta.author?.display_name || '',
        avatar_url: meta.author?.avatar_url || '',
        description: meta.content?.description || '',
        published_at: meta.published_at || null,
        views: meta.engagement?.views || 0,
        likes: meta.engagement?.likes || 0,
        comments_count: meta.engagement?.comments || 0,
        shares: meta.engagement?.shares || 0,
        saves: meta.engagement?.saves || 0,
        duration: tech.duration || meta.media?.duration || 0,
        width: tech.width || meta.media?.width || 0,
        height: tech.height || meta.media?.height || 0,
        fps: tech.fps || 0,
        video_codec: tech.video_codec || '',
        file_size: fileSize,
        sha256: manifest.hash?.value || null,
        status: manifest.status || (fileSize > 0 ? 'completed' : 'pending'),
        is_photo_mode: Boolean(meta.media?.is_photo_mode),
        directory: dirPath,
      });
      videosIndexed++;
    } catch (err: any) {
      console.warn(`[INDEX] Failed to index ${dirPath}: ${err.message}`);
    }
  }

  // Use a transaction for bulk inserts (massively faster)
  const transaction = db.transaction(() => {
    // Clear old index records so deleted directories don't leave ghost entries
    db.exec('DELETE FROM videos; DELETE FROM profiles;');

    // 1. Single videos: data/videos/<ID>/
    const singleDir = path.join(baseDataDir, 'videos');
    if (fs.existsSync(singleDir)) {
      const scanRecursive = (dir: string, depth: number = 0) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const entryPath = path.join(dir, entry.name);
          // If this directory contains metadata.json, it's a video dir
          if (fs.existsSync(path.join(entryPath, 'metadata.json'))) {
            indexVideoDir(entryPath, entry.name);
          } else if (depth < 3) {
            // Sharded subdirectory — recurse deeper
            scanRecursive(entryPath, depth + 1);
          }
        }
      };
      scanRecursive(singleDir);
    }

    // 2. Profile videos: data/profiles/<PID>/videos/<ID>/
    const profilesDir = path.join(baseDataDir, 'profiles');
    if (fs.existsSync(profilesDir)) {
      const pEntries = fs.readdirSync(profilesDir, { withFileTypes: true });
      for (const pEntry of pEntries) {
        if (!pEntry.isDirectory()) continue;
        const profileDir = path.join(profilesDir, pEntry.name);

        // Index profile.json if exists
        const profileJsonPath = path.join(profileDir, 'profile.json');
        if (fs.existsSync(profileJsonPath)) {
          try {
            const pData = JSON.parse(fs.readFileSync(profileJsonPath, 'utf-8'));
            upsertProfile({
              profile_id: pData.profile_id || pEntry.name,
              username: pData.username || '',
              display_name: pData.display_name,
              avatar_url: pData.avatar_url,
              bio: pData.bio,
              profile_url: pData.profile_url,
              followers: pData.stats?.followers || 0,
              following: pData.stats?.following || 0,
              likes: pData.stats?.likes || 0,
              videos_count: pData.stats?.videos || 0,
              status: 'completed',
              sec_uid: pData.sec_uid,
            });
            profilesIndexed++;
          } catch {}
        }

        // Scan videos inside profile
        const pVideosDir = path.join(profileDir, 'videos');
        if (fs.existsSync(pVideosDir)) {
          const scanRecursive = (dir: string, depth: number = 0) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              const entryPath = path.join(dir, entry.name);
              if (fs.existsSync(path.join(entryPath, 'metadata.json'))) {
                indexVideoDir(entryPath, entry.name, pEntry.name);
              } else if (depth < 3) {
                scanRecursive(entryPath, depth + 1);
              }
            }
          };
          scanRecursive(pVideosDir);
        }
      }
    }
  });

  transaction();

  console.log(`[INDEX] Rebuild complete: ${videosIndexed} videos, ${profilesIndexed} profiles indexed`);
  return { videosIndexed, profilesIndexed };
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
