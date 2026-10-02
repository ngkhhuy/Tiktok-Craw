import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { RateLimiter } from '../../../utils/rate-limiter.js';
import { withRetry } from '../../../utils/retry.js';
import { buildCanonicalVideoUrl } from '../parser.js';
import {
  NormalizedTikTokVideo,
  NormalizedTikTokComment,
  CommentFetchResult,
} from '../types.js';

export interface TikWMMediaInfo {
  video_url?: string;
  images?: string[];
  is_photo_mode?: boolean;
  music_url?: string;
  title?: string;
}

export function extractHashtagsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#([\w\u0080-\uffff]+)/g);
  if (!matches) return [];
  return [...new Set(matches.map((h) => h.slice(1)))];
}

export function extractMentionsFromTikWM(data: any): string[] {
  const mentions: string[] = [];
  if (data?.title) {
    const matches = data.title.match(/@([\w.-]+)/g);
    if (matches) {
      mentions.push(...matches.map((m: string) => m.slice(1)));
    }
  }
  if (Array.isArray(data?.mentioned_users)) {
    for (const u of data.mentioned_users) {
      if (typeof u === 'string') mentions.push(u);
      else if (u?.unique_id) mentions.push(u.unique_id);
    }
  }
  return [...new Set(mentions)];
}

export function normalizeTikWMVideo(
  data: any,
  rawUrl: string
): NormalizedTikTokVideo {
  const videoId = String(data.id || '');
  const username = data.author?.unique_id || '';
  const canonicalUrl = username
    ? buildCanonicalVideoUrl(username, videoId)
    : rawUrl;

  const description = data.title || data.content_desc || '';
  const hashtags = extractHashtagsFromText(description);
  const mentions = extractMentionsFromTikWM(data);

  let publishedAt: string | null = null;
  if (data.create_time) {
    try {
      publishedAt = new Date(Number(data.create_time) * 1000).toISOString();
    } catch {}
  }

  const isPhotoMode = Boolean(Array.isArray(data.images) && data.images.length > 0);
  const photoImages: string[] = isPhotoMode ? data.images : [];

  const videoUrl = !isPhotoMode ? (data.hdplay || data.play || data.wmplay || null) : null;
  const thumbnailUrl = data.origin_cover || data.cover || data.ai_dynamic_cover || null;
  const musicUrl = data.music_info?.play || data.music || null;

  const music = data.music_info
    ? {
        id: data.music_info.id ? String(data.music_info.id) : null,
        title: data.music_info.title || null,
        author: data.music_info.author || null,
      }
    : data.music
    ? {
        id: null,
        title: null,
        author: null,
      }
    : null;

  return {
    source: 'tiktok',
    video_id: videoId,
    url: rawUrl,
    canonical_url: canonicalUrl,
    author: {
      id: data.author?.id ? String(data.author.id) : null,
      username,
      display_name: data.author?.nickname || null,
      avatar_url: data.author?.avatar || null,
    },
    content: {
      description,
      hashtags,
      mentions,
      music,
    },
    engagement: {
      views: Number(data.play_count || 0),
      likes: Number(data.digg_count || 0),
      comments: Number(data.comment_count || 0),
      shares: Number(data.share_count || 0),
      saves: Number(data.collect_count || 0),
    },
    published_at: publishedAt,
    media: {
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      duration: data.duration ? Number(data.duration) : null,
      width: null,
      height: null,
      is_photo_mode: isPhotoMode,
      images: isPhotoMode ? photoImages : undefined,
      music_url: musicUrl,
    },
    platform_specific: {
      provider: 'tikwm',
      ...data,
    },
  };
}

export function normalizeTikWMComment(
  raw: any,
  videoId: string,
  parentCommentId: string | null = null
): NormalizedTikTokComment {
  const commentId = String(raw.id || raw.cid || '');
  const user = raw.user || {};

  let publishedAt: string | null = null;
  if (raw.create_time) {
    try {
      publishedAt = new Date(Number(raw.create_time) * 1000).toISOString();
    } catch {}
  }

  const isReply = Boolean(parentCommentId || raw.reply_id || raw.reply_to_reply_id);

  return {
    comment_id: commentId,
    video_id: videoId,
    parent_comment_id: parentCommentId || (raw.reply_id ? String(raw.reply_id) : null),
    author: {
      id: user.id ? String(user.id) : null,
      username: user.unique_id || '',
      display_name: user.nickname || null,
      avatar_url: user.avatar || null,
    },
    text: raw.text || '',
    like_count: Number(raw.digg_count || 0),
    published_at: publishedAt,
    is_reply: isReply,
  };
}

export class TikWMService {
  private rateLimiter: RateLimiter;
  private primaryBaseUrl = 'https://www.tikwm.com/api';
  private secondaryBaseUrl = 'https://tikwm.com/api';

  constructor() {
    this.rateLimiter = new RateLimiter(config.tikwmRateLimitMs || 1000);
  }

  /**
   * Primary 3rd-party video acquisition method.
   * Priority 1 before falling back to direct HTTP / Playwright.
   */
  async fetchVideo(videoUrl: string): Promise<NormalizedTikTokVideo> {
    logger.stage('metadata', `[TikWM] Fetching video metadata for: ${videoUrl}`);

    const baseUrls = [this.primaryBaseUrl, this.secondaryBaseUrl];

    return await withRetry(
      async () => {
        await this.rateLimiter.acquire();

        let lastError: Error | null = null;

        for (const baseUrl of baseUrls) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            // POST is preferred by TikWM to avoid URL length encoding issues
            const res = await fetch(`${baseUrl}/`, {
              method: 'POST',
              headers: {
                'User-Agent': config.userAgentDesktop,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/plain, */*',
              },
              body: `url=${encodeURIComponent(videoUrl)}&hd=1`,
              signal: controller.signal,
            });

            clearTimeout(timeout);

            if (!res.ok) {
              lastError = new Error(`TikWM endpoint ${baseUrl} returned HTTP ${res.status}`);
              continue;
            }

            const json = await res.json();

            if (json.msg && json.msg.includes('Free Api Limit')) {
              throw new Error(`TikWM Rate Limited: ${json.msg}`);
            }

            if (json.code !== 0 || !json.data) {
              lastError = new Error(`TikWM error code ${json.code}: ${json.msg || 'No data returned'}`);
              continue;
            }

            const normalized = normalizeTikWMVideo(json.data, videoUrl);
            logger.stage(
              'metadata',
              `[TikWM] Successfully acquired video ${normalized.video_id} by @${normalized.author.username}`
            );
            return normalized;
          } catch (err: any) {
            lastError = err;
            if (err.message && err.message.includes('Rate Limited')) {
              throw err; // Trigger withRetry backoff
            }
          }
        }

        throw lastError || new Error(`Failed to acquire video from TikWM endpoints`);
      },
      {
        maxRetries: 2,
        initialDelayMs: 1500,
        timeoutMs: 35000,
        shouldRetry: (err) => {
          return err.message?.includes('Rate Limited') || err.name === 'AbortError';
        },
      }
    );
  }

  /**
   * Primary 3rd-party comments acquisition method.
   */
  async fetchComments(
    videoId: string,
    videoUrl: string,
    options: { maxComments?: number; maxPages?: number } = {}
  ): Promise<CommentFetchResult> {
    const maxComments = options.maxComments ?? config.maxCommentsPerVideo;
    const maxPages = options.maxPages ?? config.maxCommentPages;

    logger.stage('comments', `[TikWM] Fetching comments for video ${videoId} (max: ${maxComments})`);

    const comments: NormalizedTikTokComment[] = [];
    const seenCommentIds = new Set<string>();
    const seenCursors = new Set<string | number>();

    let cursor: string | number = 0;
    let page = 0;
    let hasMore = true;

    try {
      while (hasMore && page < maxPages && comments.length < maxComments) {
        if (seenCursors.has(cursor)) {
          logger.debug(`[TikWM] Detected repeated cursor ${cursor}, stopping comment pagination`);
          break;
        }
        seenCursors.add(cursor);
        page++;

        await this.rateLimiter.acquire();

        const pageSize = 50;
        const apiUrl: string = `${this.primaryBaseUrl}/comment/list?url=${encodeURIComponent(
          videoUrl
        )}&count=${pageSize}&cursor=${cursor}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        const res: Response = await fetch(apiUrl, {
          headers: {
            'User-Agent': config.userAgentDesktop,
            'Accept': 'application/json, text/plain, */*',
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          if (comments.length === 0) {
            return {
              status: 'unavailable',
              comments: [],
              reason: `TikWM comments API returned HTTP ${res.status}`,
            };
          }
          break;
        }

        const json: any = await res.json();
        if (json.code !== 0 || !json.data) {
          if (comments.length === 0) {
            return {
              status: 'unavailable',
              comments: [],
              reason: json.msg || 'TikWM returned non-zero code for comments',
            };
          }
          break;
        }

        const rawComments: any[] = json.data.comments || [];
        if (rawComments.length === 0) {
          break;
        }

        const commentsWithReplies: Array<{ cid: string }> = [];

        for (const raw of rawComments) {
          if (comments.length >= maxComments) break;
          const normalized = normalizeTikWMComment(raw, videoId, null);
          if (!seenCommentIds.has(normalized.comment_id)) {
            seenCommentIds.add(normalized.comment_id);
            comments.push(normalized);
          }

          const replyTotal = Number(raw.reply_total || 0);
          if (replyTotal > 0) {
            commentsWithReplies.push({ cid: normalized.comment_id });
          }
        }

        // Fetch replies if limit allows
        if (commentsWithReplies.length > 0 && comments.length < maxComments) {
          for (const { cid } of commentsWithReplies) {
            if (comments.length >= maxComments) break;
            try {
              const replies = await this.fetchCommentReplies(videoId, cid);
              for (const reply of replies) {
                if (comments.length >= maxComments) break;
                if (!seenCommentIds.has(reply.comment_id)) {
                  seenCommentIds.add(reply.comment_id);
                  comments.push(reply);
                }
              }
            } catch (replyErr: any) {
              logger.debug(`[TikWM] Could not fetch replies for comment ${cid}: ${replyErr.message}`);
            }
          }
        }

        hasMore = Boolean(json.data.hasMore);
        cursor = json.data.cursor ?? (typeof cursor === 'number' ? cursor + pageSize : cursor);
      }

      logger.stage('comments', `[TikWM] Acquired ${comments.length} comments for video ${videoId}`);

      return {
        status: 'completed',
        comments,
        total: comments.length,
      };
    } catch (err: any) {
      logger.warn(`[TikWM] Comments acquisition issue: ${err.message}`);
      return {
        status: comments.length > 0 ? 'completed' : 'unavailable',
        comments,
        total: comments.length,
        reason: err.message,
      };
    }
  }

  async fetchCommentReplies(
    videoId: string,
    commentId: string
  ): Promise<NormalizedTikTokComment[]> {
    await this.rateLimiter.acquire();
    const apiUrl = `${this.primaryBaseUrl}/comment/reply?video_id=${encodeURIComponent(
      videoId
    )}&comment_id=${encodeURIComponent(commentId)}&cursor=0`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': config.userAgentDesktop,
        'Accept': 'application/json, text/plain, */*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return [];

    const json = await res.json();
    if (json.code !== 0 || !json.data || !Array.isArray(json.data.comments)) {
      return [];
    }

    return json.data.comments.map((r: any) =>
      normalizeTikWMComment(r, videoId, commentId)
    );
  }

  /**
   * Fallback media resolution for videos where stream URL is needed.
   */
  async resolveMedia(videoUrl: string, videoId: string): Promise<TikWMMediaInfo | null> {
    try {
      const normalized = await this.fetchVideo(videoUrl);
      if (normalized.media.is_photo_mode && normalized.media.images) {
        return {
          images: normalized.media.images,
          is_photo_mode: true,
          music_url: normalized.media.music_url || undefined,
          title: normalized.content.description,
        };
      }
      if (normalized.media.video_url) {
        return {
          video_url: normalized.media.video_url,
          music_url: normalized.media.music_url || undefined,
          title: normalized.content.description,
          is_photo_mode: false,
        };
      }
      return null;
    } catch (err: any) {
      logger.warn(`[TikWM] Media resolve failed for ${videoId}: ${err.message}`);
      return null;
    }
  }
}

export const tikwmService = new TikWMService();
