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

    CREATE TABLE IF NOT EXISTS comments (
      comment_id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      parent_comment_id TEXT,
      author_id TEXT,
      author_username TEXT,
      author_display_name TEXT,
      text TEXT NOT NULL,
      like_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      is_reply INTEGER DEFAULT 0,
      published_at TEXT,
      sentiment_label TEXT,
      sentiment_score REAL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
    CREATE INDEX IF NOT EXISTS idx_comments_published ON comments(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);

    CREATE TABLE IF NOT EXISTS video_metric_snapshots (
      snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      like_rate REAL,
      comment_rate REAL,
      share_rate REAL,
      engagement_rate REAL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_video_time ON video_metric_snapshots(video_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS vector_embeddings (
      embedding_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      dimensions INTEGER NOT NULL,
      model TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON vector_embeddings(entity_type, entity_id);
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

// ─── Comment CRUD ────────────────────────────────────────────

export interface CommentRecord {
  comment_id: string;
  video_id: string;
  parent_comment_id?: string | null;
  author_id?: string | null;
  author_username?: string | null;
  author_display_name?: string | null;
  text: string;
  like_count?: number;
  reply_count?: number;
  is_reply?: boolean | number;
  published_at?: string | null;
  sentiment_label?: string | null;
  sentiment_score?: number | null;
  created_at?: string;
}

export function upsertComment(record: CommentRecord): void {
  const db = getDb();
  const now = record.created_at || new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO comments (
      comment_id, video_id, parent_comment_id, author_id,
      author_username, author_display_name, text, like_count,
      reply_count, is_reply, published_at, sentiment_label,
      sentiment_score, created_at
    ) VALUES (
      @comment_id, @video_id, @parent_comment_id, @author_id,
      @author_username, @author_display_name, @text, @like_count,
      @reply_count, @is_reply, @published_at, @sentiment_label,
      @sentiment_score, @created_at
    )
    ON CONFLICT(comment_id) DO UPDATE SET
      text = @text,
      like_count = CASE WHEN @like_count > 0 THEN @like_count ELSE like_count END,
      reply_count = CASE WHEN @reply_count > 0 THEN @reply_count ELSE reply_count END,
      sentiment_label = COALESCE(@sentiment_label, sentiment_label),
      sentiment_score = COALESCE(@sentiment_score, sentiment_score)
  `);

  stmt.run({
    comment_id: record.comment_id,
    video_id: record.video_id,
    parent_comment_id: record.parent_comment_id || null,
    author_id: record.author_id || null,
    author_username: record.author_username || null,
    author_display_name: record.author_display_name || null,
    text: record.text || '',
    like_count: record.like_count || 0,
    reply_count: record.reply_count || 0,
    is_reply: record.is_reply ? 1 : 0,
    published_at: record.published_at || null,
    sentiment_label: record.sentiment_label || null,
    sentiment_score: record.sentiment_score ?? null,
    created_at: now,
  });
}

export function upsertCommentsBatch(records: CommentRecord[]): number {
  if (!records || records.length === 0) return 0;
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO comments (
      comment_id, video_id, parent_comment_id, author_id,
      author_username, author_display_name, text, like_count,
      reply_count, is_reply, published_at, sentiment_label,
      sentiment_score, created_at
    ) VALUES (
      @comment_id, @video_id, @parent_comment_id, @author_id,
      @author_username, @author_display_name, @text, @like_count,
      @reply_count, @is_reply, @published_at, @sentiment_label,
      @sentiment_score, @created_at
    )
    ON CONFLICT(comment_id) DO UPDATE SET
      text = @text,
      like_count = CASE WHEN @like_count > 0 THEN @like_count ELSE like_count END,
      reply_count = CASE WHEN @reply_count > 0 THEN @reply_count ELSE reply_count END,
      sentiment_label = COALESCE(@sentiment_label, sentiment_label),
      sentiment_score = COALESCE(@sentiment_score, sentiment_score)
  `);

  const runBatch = db.transaction((items: CommentRecord[]) => {
    let count = 0;
    for (const r of items) {
      stmt.run({
        comment_id: r.comment_id,
        video_id: r.video_id,
        parent_comment_id: r.parent_comment_id && r.parent_comment_id !== '0' ? r.parent_comment_id : null,
        author_id: r.author_id || null,
        author_username: r.author_username || null,
        author_display_name: r.author_display_name || null,
        text: r.text || '',
        like_count: r.like_count || 0,
        reply_count: r.reply_count || 0,
        is_reply: r.is_reply ? 1 : 0,
        published_at: r.published_at || null,
        sentiment_label: r.sentiment_label || null,
        sentiment_score: r.sentiment_score ?? null,
        created_at: r.created_at || now,
      });
      count++;
    }
    return count;
  });

  return runBatch(records);
}

export function getCommentsByVideoId(videoId: string, limit: number = 100): CommentRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM comments WHERE video_id = ? ORDER BY like_count DESC, published_at DESC LIMIT ?
  `).all(videoId, limit) as CommentRecord[];
}

export function searchComments(query: string, limit: number = 50): CommentRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM comments WHERE text LIKE ? ORDER BY like_count DESC LIMIT ?
  `).all(`%${query}%`, limit) as CommentRecord[];
}

export function countComments(videoId?: string): number {
  const db = getDb();
  if (videoId) {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE video_id = ?').get(videoId) as any;
    return row?.cnt || 0;
  }
  const row = db.prepare('SELECT COUNT(*) as cnt FROM comments').get() as any;
  return row?.cnt || 0;
}

// ─── Metric Snapshots CRUD ───────────────────────────────────

export interface MetricSnapshotRecord {
  snapshot_id?: number;
  video_id: string;
  captured_at: string;
  views: number;
  likes: number;
  comments_count: number;
  shares: number;
  saves: number;
  like_rate?: number | null;
  comment_rate?: number | null;
  share_rate?: number | null;
  engagement_rate?: number | null;
}

export function insertMetricSnapshot(record: MetricSnapshotRecord): void {
  const db = getDb();
  const v = record.views || 0;
  const l = record.likes || 0;
  const c = record.comments_count || 0;
  const s = record.shares || 0;
  const likeRate = v > 0 ? l / v : null;
  const commentRate = v > 0 ? c / v : null;
  const shareRate = v > 0 ? s / v : null;
  const engagementRate = v > 0 ? (l + c + s) / v : null;

  db.prepare(`
    INSERT INTO video_metric_snapshots (
      video_id, captured_at, views, likes, comments_count,
      shares, saves, like_rate, comment_rate, share_rate, engagement_rate
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    record.video_id,
    record.captured_at || new Date().toISOString(),
    v,
    l,
    c,
    s,
    record.saves || 0,
    record.like_rate ?? likeRate,
    record.comment_rate ?? commentRate,
    record.share_rate ?? shareRate,
    record.engagement_rate ?? engagementRate
  );
}

export function getMetricSnapshots(videoId: string): MetricSnapshotRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM video_metric_snapshots WHERE video_id = ? ORDER BY captured_at ASC
  `).all(videoId) as MetricSnapshotRecord[];
}

// ─── Vector Embeddings CRUD ──────────────────────────────────

export interface VectorEmbeddingRecord {
  embedding_id: string;
  entity_type: string;
  entity_id: string;
  chunk_text: string;
  embedding: Buffer;
  dimensions: number;
  model: string;
  metadata_json?: string | null;
  created_at?: string;
}

export function upsertVectorEmbedding(record: VectorEmbeddingRecord): void {
  const db = getDb();
  const now = record.created_at || new Date().toISOString();
  db.prepare(`
    INSERT INTO vector_embeddings (
      embedding_id, entity_type, entity_id, chunk_text,
      embedding, dimensions, model, metadata_json, created_at
    ) VALUES (
      @embedding_id, @entity_type, @entity_id, @chunk_text,
      @embedding, @dimensions, @model, @metadata_json, @created_at
    )
    ON CONFLICT(embedding_id) DO UPDATE SET
      chunk_text = @chunk_text,
      embedding = @embedding,
      dimensions = @dimensions,
      model = @model,
      metadata_json = @metadata_json
  `).run({
    embedding_id: record.embedding_id,
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    chunk_text: record.chunk_text,
    embedding: record.embedding,
    dimensions: record.dimensions,
    model: record.model,
    metadata_json: record.metadata_json || null,
    created_at: now,
  });
}

export function upsertVectorEmbeddingsBatch(records: VectorEmbeddingRecord[]): number {
  if (!records || records.length === 0) return 0;
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO vector_embeddings (
      embedding_id, entity_type, entity_id, chunk_text,
      embedding, dimensions, model, metadata_json, created_at
    ) VALUES (
      @embedding_id, @entity_type, @entity_id, @chunk_text,
      @embedding, @dimensions, @model, @metadata_json, @created_at
    )
    ON CONFLICT(embedding_id) DO UPDATE SET
      chunk_text = @chunk_text,
      embedding = @embedding,
      dimensions = @dimensions,
      model = @model,
      metadata_json = @metadata_json
  `);

  const runBatch = db.transaction((items: VectorEmbeddingRecord[]) => {
    let count = 0;
    for (const r of items) {
      stmt.run({
        embedding_id: r.embedding_id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        chunk_text: r.chunk_text,
        embedding: r.embedding,
        dimensions: r.dimensions,
        model: r.model,
        metadata_json: r.metadata_json || null,
        created_at: r.created_at || now,
      });
      count++;
    }
    return count;
  });

  return runBatch(records);
}

export function getAllVectorEmbeddings(entityType?: string): VectorEmbeddingRecord[] {
  const db = getDb();
  if (entityType) {
    return db.prepare('SELECT * FROM vector_embeddings WHERE entity_type = ?').all(entityType) as VectorEmbeddingRecord[];
  }
  return db.prepare('SELECT * FROM vector_embeddings').all() as VectorEmbeddingRecord[];
}

export function countVectorEmbeddings(entityType?: string): number {
  const db = getDb();
  if (entityType) {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM vector_embeddings WHERE entity_type = ?').get(entityType) as any;
    return row?.cnt || 0;
  }
  const row = db.prepare('SELECT COUNT(*) as cnt FROM vector_embeddings').get() as any;
  return row?.cnt || 0;
}

// ─── Query API ───────────────────────────────────────────────

export interface VideosQueryOptions {
  page?: number;
  limit?: number;
  sort?: 'newest' | 'oldest' | 'views' | 'likes' | 'size';
  search?: string;
  profileId?: string;
  username?: string;
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
  const limit = options.limit && options.limit > 0 ? Math.min(5000, options.limit) : 50;
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

  if (options.profileId && options.username) {
    conditions.push('(profile_id = @filterProfileId OR username = @filterUsername OR username = @filterProfileId)');
    params.filterProfileId = options.profileId;
    params.filterUsername = options.username;
  } else if (options.profileId) {
    conditions.push('(profile_id = @filterProfileId OR username = @filterProfileId)');
    params.filterProfileId = options.profileId;
  } else if (options.username) {
    conditions.push('(username = @filterUsername OR profile_id = @filterUsername)');
    params.filterUsername = options.username;
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

export function rebuildIndex(): { videosIndexed: number; profilesIndexed: number; commentsIndexed: number; snapshotsCreated: number } {
  const db = getDb();
  const baseDataDir = config.dataDir;
  let videosIndexed = 0;
  let profilesIndexed = 0;
  let commentsIndexed = 0;
  let snapshotsCreated = 0;

  console.log('[INDEX] Rebuilding SQLite index from disk...');

  const insertCommentStmt = db.prepare(`
    INSERT INTO comments (
      comment_id, video_id, parent_comment_id, author_id,
      author_username, author_display_name, text, like_count,
      reply_count, is_reply, published_at, sentiment_label,
      sentiment_score, created_at
    ) VALUES (
      @comment_id, @video_id, @parent_comment_id, @author_id,
      @author_username, @author_display_name, @text, @like_count,
      @reply_count, @is_reply, @published_at, @sentiment_label,
      @sentiment_score, @created_at
    )
    ON CONFLICT(comment_id) DO UPDATE SET
      text = @text,
      like_count = CASE WHEN @like_count > 0 THEN @like_count ELSE like_count END,
      reply_count = CASE WHEN @reply_count > 0 THEN @reply_count ELSE reply_count END
  `);

  const insertSnapshotStmt = db.prepare(`
    INSERT INTO video_metric_snapshots (
      video_id, captured_at, views, likes, comments_count,
      shares, saves, like_rate, comment_rate, share_rate, engagement_rate
    SELECT
      @video_id, @captured_at, @views, @likes, @comments_count,
      @shares, @saves, @like_rate, @comment_rate, @share_rate, @engagement_rate
    WHERE NOT EXISTS (
      SELECT 1 FROM video_metric_snapshots
      WHERE video_id = @video_id AND captured_at = @captured_at
    )
  `);

  const migrateLegacySnapshotTimeStmt = db.prepare(`
    UPDATE video_metric_snapshots
    SET captured_at = @captured_at
    WHERE video_id = @video_id
      AND captured_at = @legacy_captured_at
      AND NOT EXISTS (
        SELECT 1 FROM video_metric_snapshots
        WHERE video_id = @video_id AND captured_at = @captured_at
      )
  `);

  const deleteDuplicateLegacySnapshotStmt = db.prepare(`
    DELETE FROM video_metric_snapshots
    WHERE video_id = @video_id
      AND captured_at = @legacy_captured_at
      AND EXISTS (
        SELECT 1 FROM video_metric_snapshots
        WHERE video_id = @video_id AND captured_at = @captured_at
      )
  `);

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

      // A metric snapshot represents when TikTok was observed, not when the
      // video was published. The metadata-stage timestamp is the most precise
      // crawl observation; older artifacts fall back to manifest completion or
      // the metadata file's modification time.
      const metadataCapturedAt = manifest?.stages?.metadata?.completed_at
        || manifest?.completed_at
        || fs.statSync(metaPath).mtime.toISOString();

      const videoFilePath = path.join(dirPath, 'video.mp4');
      const fileSize = fs.existsSync(videoFilePath) ? fs.statSync(videoFilePath).size : 0;

      const vViews = meta.engagement?.views || 0;
      const vLikes = meta.engagement?.likes || 0;
      let vComments = meta.engagement?.comments || 0;
      const vShares = meta.engagement?.shares || 0;
      const vSaves = meta.engagement?.saves || 0;

      // Index comments if comments.json exists
      const commentsPath = path.join(dirPath, 'comments.json');
      if (fs.existsSync(commentsPath)) {
        try {
          const comObj = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
          if (Array.isArray(comObj?.comments)) {
            if (comObj.comments.length > vComments) {
              vComments = comObj.comments.length;
            }
            const nowIso = new Date().toISOString();
            for (const c of comObj.comments) {
              insertCommentStmt.run({
                comment_id: c.comment_id,
                video_id: videoId,
                parent_comment_id: c.parent_comment_id && c.parent_comment_id !== '0' ? c.parent_comment_id : null,
                author_id: c.author?.id || null,
                author_username: c.author?.username || null,
                author_display_name: c.author?.display_name || null,
                text: c.text || '',
                like_count: c.like_count || 0,
                reply_count: c.reply_count || c.reply_comment_total || 0,
                is_reply: c.is_reply ? 1 : 0,
                published_at: c.published_at || null,
                sentiment_label: null,
                sentiment_score: null,
                created_at: c.published_at || nowIso,
              });
              commentsIndexed++;
            }
          }
        } catch {}
      }

      upsertVideo({
        video_id: videoId,
        profile_id: profileId || null,
        username: meta.author?.username || '',
        display_name: meta.author?.display_name || '',
        avatar_url: meta.author?.avatar_url || '',
        description: meta.content?.description || '',
        published_at: meta.published_at || null,
        views: vViews,
        likes: vLikes,
        comments_count: vComments,
        shares: vShares,
        saves: vSaves,
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

      // Migrate snapshots created by older versions that incorrectly used the
      // TikTok publication time as the observation time.
      if (meta.published_at && metadataCapturedAt !== meta.published_at) {
        deleteDuplicateLegacySnapshotStmt.run({
          video_id: videoId,
          captured_at: metadataCapturedAt,
          legacy_captured_at: meta.published_at,
        });
        migrateLegacySnapshotTimeStmt.run({
          video_id: videoId,
          captured_at: metadataCapturedAt,
          legacy_captured_at: meta.published_at,
        });
      }

      // Preserve all historic observations during rebuild. Add one only when
      // this artifact has never contributed its original crawl-time snapshot.
      const snapshotResult = insertSnapshotStmt.run({
        video_id: videoId,
        captured_at: metadataCapturedAt,
        views: vViews,
        likes: vLikes,
        comments_count: vComments,
        shares: vShares,
        saves: vSaves,
        like_rate: vViews > 0 ? vLikes / vViews : null,
        comment_rate: vViews > 0 ? vComments / vViews : null,
        share_rate: vViews > 0 ? vShares / vViews : null,
        engagement_rate: vViews > 0 ? (vLikes + vComments + vShares) / vViews : null,
      });
      snapshotsCreated += snapshotResult.changes;
    } catch (err: any) {
      console.warn(`[INDEX] Failed to index ${dirPath}: ${err.message}`);
    }
  }

  // Use a transaction for bulk inserts (massively faster)
  const transaction = db.transaction(() => {
    // Clear old index records so deleted directories don't leave ghost entries
    // Snapshots are a time series and must survive an index rebuild. Videos,
    // profiles and comments are reconstructed from their current artifacts.
    db.exec('DELETE FROM videos; DELETE FROM profiles; DELETE FROM comments;');

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
          } else if (depth < 6) {
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
              } else if (depth < 6) {
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

  console.log(`[INDEX] Rebuild complete: ${videosIndexed} videos, ${profilesIndexed} profiles, ${commentsIndexed} comments indexed`);
  return { videosIndexed, profilesIndexed, commentsIndexed, snapshotsCreated };
}

export function ingestAllComments(): { commentsIngested: number; videosChecked: number } {
  const db = getDb();
  const baseDataDir = config.dataDir;
  let commentsIngested = 0;
  let videosChecked = 0;

  console.log('[INDEX] Ingesting all comments from disk...');

  const scanRecursive = (dir: string, depth: number = 0) => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(dir, entry.name);
      const commentsPath = path.join(entryPath, 'comments.json');
      if (fs.existsSync(commentsPath)) {
        videosChecked++;
        try {
          const comObj = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
          const commentsList = Array.isArray(comObj?.comments) ? comObj.comments : (Array.isArray(comObj) ? comObj : []);
          if (commentsList.length > 0) {
            const videoId = entry.name;
            const records: CommentRecord[] = commentsList.map((c: any) => ({
              comment_id: c.comment_id,
              video_id: c.video_id || videoId,
              parent_comment_id: c.parent_comment_id && c.parent_comment_id !== '0' ? c.parent_comment_id : null,
              author_id: c.author?.id || null,
              author_username: c.author?.username || null,
              author_display_name: c.author?.display_name || null,
              text: c.text || '',
              like_count: c.like_count || 0,
              reply_count: c.reply_count || c.reply_comment_total || 0,
              is_reply: c.is_reply ? 1 : 0,
              published_at: c.published_at || null,
            }));
            const inserted = upsertCommentsBatch(records);
            commentsIngested += inserted;
          }
        } catch {}
      } else if (depth < 8) {
        scanRecursive(entryPath, depth + 1);
      }
    }
  };

  scanRecursive(path.join(baseDataDir, 'videos'));
  scanRecursive(path.join(baseDataDir, 'profiles'));

  console.log(`[INDEX] Ingested ${commentsIngested} comments across ${videosChecked} video folders`);
  return { commentsIngested, videosChecked };
}

export interface ProfileSummary {
  profileId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  profileUrl: string;
  followers: number;
  tiktokLikes: number;
  tiktokVideos: number;
  localVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalSize: number;
  lastUpdated: string | null;
}

export function getProfilesSummary(): ProfileSummary[] {
  const db = getDb();
  const profilesDir = path.resolve(config.dataDir, 'profiles');
  const map = new Map<string, ProfileSummary>();

  if (fs.existsSync(profilesDir)) {
    try {
      const dirs = fs.readdirSync(profilesDir);
      for (const d of dirs) {
        const pJson = path.join(profilesDir, d, 'profile.json');
        if (fs.existsSync(pJson)) {
          try {
            const raw = JSON.parse(fs.readFileSync(pJson, 'utf-8'));
            const pId = String(raw.profile_id || d);
            map.set(pId, {
              profileId: pId,
              username: raw.username || '',
              displayName: raw.display_name || raw.username || '',
              avatarUrl: raw.avatar_url || '',
              bio: raw.bio || '',
              profileUrl: raw.profile_url || `https://www.tiktok.com/@${raw.username}`,
              followers: Number(raw.stats?.followers || 0),
              tiktokLikes: Number(raw.stats?.likes || 0),
              tiktokVideos: Number(raw.stats?.videos || 0),
              localVideos: 0,
              totalViews: 0,
              totalLikes: 0,
              totalComments: 0,
              totalSize: 0,
              lastUpdated: null,
            });
          } catch {}
        }
      }
    } catch {}
  }

  for (const [pId, p] of map.entries()) {
    const stats: any = db.prepare(`
      SELECT 
        count(*) as count,
        COALESCE(sum(views), 0) as total_views,
        COALESCE(sum(likes), 0) as total_likes,
        COALESCE(sum(comments_count), 0) as total_comments,
        COALESCE(sum(file_size), 0) as total_size,
        max(updated_at) as last_updated
      FROM videos 
      WHERE (profile_id = ? OR username = ?) AND status = 'completed'
    `).get(pId, p.username);
    if (stats) {
      p.localVideos = Number(stats.count || 0);
      p.totalViews = Number(stats.total_views || 0);
      p.totalLikes = Number(stats.total_likes || 0);
      p.totalComments = Number(stats.total_comments || 0);
      p.totalSize = Number(stats.total_size || 0);
      p.lastUpdated = stats.last_updated || null;
    }
  }

  // Also check distinct creators from SQLite that may not have profile.json
  const dbAuthors: any[] = db.prepare(`
    SELECT DISTINCT username, profile_id, display_name, avatar_url, count(*) as count,
           COALESCE(sum(views), 0) as total_views,
           COALESCE(sum(likes), 0) as total_likes,
           COALESCE(sum(comments_count), 0) as total_comments,
           COALESCE(sum(file_size), 0) as total_size,
           max(updated_at) as last_updated
    FROM videos
    WHERE status = 'completed' AND username IS NOT NULL AND username != ''
    GROUP BY username
  `).all();

  for (const row of dbAuthors) {
    let exists = false;
    for (const p of map.values()) {
      if (p.username.toLowerCase() === String(row.username).toLowerCase() || (row.profile_id && p.profileId === String(row.profile_id))) {
        exists = true;
        break;
      }
    }
    if (!exists && row.username) {
      map.set(row.profile_id || row.username, {
        profileId: String(row.profile_id || row.username),
        username: row.username,
        displayName: row.display_name || row.username,
        avatarUrl: row.avatar_url || '',
        bio: '',
        profileUrl: `https://www.tiktok.com/@${row.username}`,
        followers: 0,
        tiktokLikes: 0,
        tiktokVideos: Number(row.count || 0),
        localVideos: Number(row.count || 0),
        totalViews: Number(row.total_views || 0),
        totalLikes: Number(row.total_likes || 0),
        totalComments: Number(row.total_comments || 0),
        totalSize: Number(row.total_size || 0),
        lastUpdated: row.last_updated || null,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.localVideos - a.localVideos || b.followers - a.followers);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

