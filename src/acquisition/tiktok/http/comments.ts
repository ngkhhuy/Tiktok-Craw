import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { commentsHttpClient } from './client.js';
import {
  NormalizedTikTokComment,
  CommentFetchResult,
} from '../types.js';

export function normalizeComment(raw: any, videoId: string, parentCommentId: string | null = null): NormalizedTikTokComment {
  const commentId = String(raw.cid || raw.id || '');
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
      id: user.uid ? String(user.uid) : null,
      username: user.unique_id || user.short_id || '',
      display_name: user.nickname || null,
      avatar_url: user.avatar_thumb?.url_list?.[0] || user.avatar_thumb || null,
    },
    text: raw.text || '',
    like_count: Number(raw.digg_count || 0),
    published_at: publishedAt,
    is_reply: isReply,
  };
}

export async function fetchCommentsHttp(
  videoId: string,
  videoUrl: string,
  options: { maxComments?: number; maxPages?: number } = {}
): Promise<CommentFetchResult> {
  const maxComments = options.maxComments ?? config.maxCommentsPerVideo;
  const maxPages = options.maxPages ?? config.maxCommentPages;

  logger.stage('comments', `Fetching comments for video: ${videoId} (max: ${maxComments})`);

  const comments: NormalizedTikTokComment[] = [];
  const seenCommentIds = new Set<string>();
  const seenCursors = new Set<string | number>();

  let cursor: string | number = 0;
  let page = 0;
  let hasMore = true;

  try {
    while (hasMore && page < maxPages && comments.length < maxComments) {
      if (seenCursors.has(cursor)) {
        logger.debug(`Detected repeated cursor ${cursor}, stopping comment pagination`);
        break;
      }
      seenCursors.add(cursor);
      page++;

      const pageSize = 50;
      const apiUrl = `https://www.tiktok.com/api/comment/list/?aid=1988&aweme_id=${videoId}&count=${pageSize}&cursor=${cursor}`;
      const res = await commentsHttpClient.get(apiUrl, {
        headers: {
          'Referer': videoUrl,
          'Accept': 'application/json, text/plain, */*',
        },
      });

      if (res.status !== 200 || !res.data) {
        if (comments.length === 0) {
          return {
            status: 'unavailable',
            comments: [],
            reason: `TikTok comments endpoint returned status ${res.status}`,
          };
        }
        break;
      }

      const json = res.data;
      const rawComments: any[] = json.comments || [];

      if (rawComments.length === 0) {
        break;
      }

      const commentsWithReplies: Array<{ cid: string }> = [];

      for (const raw of rawComments) {
        if (comments.length >= maxComments) break;
        const normalized = normalizeComment(raw, videoId, null);
        if (!seenCommentIds.has(normalized.comment_id)) {
          seenCommentIds.add(normalized.comment_id);
          comments.push(normalized);
        }

        const replyTotal = Number(raw.reply_comment_total || 0);
        if (replyTotal > 0) {
          commentsWithReplies.push({ cid: normalized.comment_id });
        }
      }

      // Fetch replies in parallel for this batch to eliminate sequential network latency
      if (commentsWithReplies.length > 0 && comments.length < maxComments) {
        const replyTasks = commentsWithReplies.map(async ({ cid }) => {
          try {
            return await fetchCommentRepliesHttp(videoId, cid, videoUrl);
          } catch (e: any) {
            logger.debug(`Could not fetch replies for comment ${cid}: ${e.message}`);
            return [];
          }
        });

        const replyResults = await Promise.allSettled(replyTasks);
        for (const resItem of replyResults) {
          if (resItem.status === 'fulfilled' && Array.isArray(resItem.value)) {
            for (const reply of resItem.value) {
              if (comments.length >= maxComments) break;
              if (!seenCommentIds.has(reply.comment_id)) {
                seenCommentIds.add(reply.comment_id);
                comments.push(reply);
              }
            }
          }
        }
      }

      hasMore = Boolean(json.has_more);
      cursor = json.cursor ?? (typeof cursor === 'number' ? cursor + pageSize : cursor);
    }

    logger.stage('comments', `Fetched ${comments.length} comments for video ${videoId}`);

    return {
      status: 'completed',
      comments,
      total: comments.length,
    };
  } catch (err: any) {
    logger.warn(`Comments acquisition encountered issue: ${err.message}`);
    return {
      status: 'unavailable',
      comments,
      reason: err.message,
    };
  }
}

export async function fetchCommentRepliesHttp(
  videoId: string,
  commentId: string,
  videoUrl: string
): Promise<NormalizedTikTokComment[]> {
  const replyUrl = `https://www.tiktok.com/api/comment/list/reply/?aid=1988&item_id=${videoId}&comment_id=${commentId}&count=50&cursor=0`;
  const res = await commentsHttpClient.get(replyUrl, {
    headers: {
      'Referer': videoUrl,
      'Accept': 'application/json, text/plain, */*',
    },
  });

  if (res.status !== 200 || !res.data) {
    return [];
  }

  const rawReplies: any[] = res.data.comments || [];
  return rawReplies.map((r: any) => normalizeComment(r, videoId, commentId));
}
