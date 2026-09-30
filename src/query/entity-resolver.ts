/**
 * Entity Resolver for TikTok Analytics Queries
 * 
 * Extracts video IDs, URLs, creator handles, metrics, and temporal/statistical filters
 * from Vietnamese and English natural language user queries.
 */

import { parseTikTokUrl } from '../acquisition/tiktok/parser.js';
import { AggregationType, SupportedMetric } from '../analytics/metric-definitions.js';
import { ResolvedEntities } from './intents.js';

export interface ContextHistory {
  lastVideoIds?: string[];
  lastCreator?: string;
  lastMetric?: SupportedMetric;
}

export class EntityResolver {
  /**
   * Resolves entities from text and optional conversation history.
   */
  resolve(text: string, context?: ContextHistory): ResolvedEntities {
    const videoIds = this.extractVideoIds(text, context);
    const creator = this.extractCreator(text, context);
    const metrics = this.extractMetrics(text);
    const aggregation = this.extractAggregation(text);
    const { isRanking, limit, order } = this.extractRankingParameters(text);
    const searchTerm = this.extractSearchTerm(text);

    return {
      videoIds,
      creator,
      metrics: metrics.length > 0 ? metrics : ['views'],
      aggregation,
      filters: {
        creator,
        keyword: searchTerm,
      },
      isRanking,
      limit,
      order,
      searchTerm,
    };
  }

  /**
   * Extracts video IDs directly or parses from TikTok URLs.
   */
  private extractVideoIds(text: string, context?: ContextHistory): string[] {
    const ids = new Set<string>();

    // 1. Check for URLs
    const urlMatches = text.match(/https?:\/\/[^\s]+/g);
    if (urlMatches) {
      for (const u of urlMatches) {
        try {
          const parsed = parseTikTokUrl(u);
          if (parsed && parsed.videoId) {
            ids.add(parsed.videoId);
          }
        } catch {}
      }
    }

    // 2. Direct 18-20 digit IDs (TikTok video IDs are usually 19 digits)
    const idMatches = text.match(/\b\d{18,20}\b/g);
    if (idMatches) {
      for (const id of idMatches) {
        ids.add(id);
      }
    }

    // 3. Fallback to conversation context if query refers to "video đó", "video này", "nó"
    if (ids.size === 0 && context?.lastVideoIds && context.lastVideoIds.length > 0) {
      const lower = text.toLowerCase();
      const refersToPrevious =
        /(^|[\s,.\-!?:;"'()\[\]{}#@/\\_])(video đó|video này|còn video|video vừa rồi|nó|video kia|cả hai|cả 2)($|[\s,.\-!?:;"'()\[\]{}#@/\\_])/i.test(
          lower
        ) || /(video đó|video này|video trên)/i.test(lower);
      if (refersToPrevious) {
        for (const id of context.lastVideoIds) {
          ids.add(id);
        }
      }
    }

    return Array.from(ids);
  }

  /**
   * Extracts creator username (@username or "kênh X").
   */
  private extractCreator(text: string, context?: ContextHistory): string | undefined {
    // 1. Check @username
    const handleMatch = text.match(/@([a-zA-Z0-9_.-]+)/);
    if (handleMatch) {
      return handleMatch[1];
    }

    // 2. Check "kênh <username>" or "creator <username>"
    const channelMatch = text.match(/(?:kênh|creator|tác giả|channel)\s+([a-zA-Z0-9_.-]+)/i);
    if (channelMatch) {
      return channelMatch[1].replace(/^@/, '');
    }

    // 3. Fallback to context
    if (context?.lastCreator) {
      const lower = text.toLowerCase();
      if (/(kênh đó|creator đó|kênh này|kênh|họ|ông này)/i.test(lower)) {
        return context.lastCreator;
      }
    }

    return undefined;
  }

  /**
   * Identifies metrics referenced in the query.
   */
  private extractMetrics(text: string): SupportedMetric[] {
    const lower = text.toLowerCase();
    const metrics: SupportedMetric[] = [];

    if (/\b(view|lượt xem|lượt view|xem|views)\b/.test(lower)) {
      metrics.push('views');
    }
    if (/\b(like|tim|thích|lượt thích|lượt tim|likes)\b/.test(lower)) {
      metrics.push('likes');
    }
    if (/\b(comment|bình luận|bl|cmt|comments)\b/.test(lower)) {
      metrics.push('comments');
    }
    if (/\b(share|chia sẻ|lượt share|shares)\b/.test(lower)) {
      metrics.push('shares');
    }
    if (/\b(save|lưu|bookmark|saves)\b/.test(lower)) {
      metrics.push('saves');
    }
    if (/\b(thời lượng|độ dài|dài bao lâu|duration|giây|s)\b/.test(lower)) {
      metrics.push('duration');
    }
    if (/\b(like_rate|tỉ lệ thích|tỷ lệ like|tỷ lệ tim)\b/.test(lower)) {
      metrics.push('like_rate');
    }
    if (/\b(comment_rate|tỉ lệ bình luận|tỷ lệ cmt)\b/.test(lower)) {
      metrics.push('comment_rate');
    }
    if (/\b(share_rate|tỉ lệ chia sẻ)\b/.test(lower)) {
      metrics.push('share_rate');
    }
    if (/\b(engagement|tương tác|engagement_rate|tỉ lệ tương tác|tỷ lệ tương tác)\b/.test(lower)) {
      metrics.push('engagement_rate');
    }

    return metrics;
  }

  /**
   * Identifies mathematical aggregation requested.
   */
  private extractAggregation(text: string): AggregationType | undefined {
    const lower = text.toLowerCase();
    if (/\b(tổng|tổng cộng|sum|toàn bộ|tổng số)\b/.test(lower)) return 'SUM';
    if (/\b(trung bình|avg|average|bình quân)\b/.test(lower)) return 'AVG';
    if (/\b(trung vị|median|ở giữa)\b/.test(lower)) return 'MEDIAN';
    if (/\b(cao nhất|nhiều nhất|lớn nhất|max|đỉnh nhất)\b/.test(lower)) return 'MAX';
    if (/\b(thấp nhất|ít nhất|nhỏ nhất|min|kém nhất)\b/.test(lower)) return 'MIN';
    if (/\b(đếm|bao nhiêu video|có mấy video|số lượng video|count)\b/.test(lower)) return 'COUNT';
    if (/\b(tỉ lệ|tỷ lệ|gấp mấy lần|ratio|so sánh tỉ lệ)\b/.test(lower)) return 'RATIO';
    return undefined;
  }

  /**
   * Extracts ranking order and limits (e.g. "top 5 video", "video ít view nhất").
   */
  private extractRankingParameters(text: string): { isRanking: boolean; limit: number; order: 'DESC' | 'ASC' } {
    const lower = text.toLowerCase();
    const hasRankingKeyword =
      /(^|[\s,.\-!?:;"'()\[\]{}#@/\\_])(top|bottom|nhiều nhất|ít nhất|cao nhất|thấp nhất|dẫn đầu|kém nhất|vô địch)($|[\s,.\-!?:;"'()\[\]{}#@/\\_])/i.test(
        lower
      ) ||
      /\btop\s*\d+/i.test(lower) ||
      /\bbottom\s*\d+/i.test(lower) ||
      /(nhiều nhất|ít nhất|cao nhất|thấp nhất)/i.test(lower);

    let order: 'DESC' | 'ASC' = 'DESC';
    let limit = 10;

    if (/(ít nhất|thấp nhất|kém nhất|bottom|tệ nhất)/i.test(lower)) {
      order = 'ASC';
    }

    const topMatch = lower.match(/(?:top|bottom)\s*(\d+)/i) || lower.match(/(\d+)\s*(?:video|clip|bài)/i);
    if (topMatch) {
      limit = Math.min(50, Math.max(1, parseInt(topMatch[1], 10)));
    } else if (/(duy nhất|1 video|nhất|dẫn đầu|vô địch)/i.test(lower) && !lower.includes('top')) {
      limit = 1;
    }

    return { isRanking: hasRankingKeyword, limit, order };
  }

  /**
   * Extracts search term for comments or captions.
   */
  private extractSearchTerm(text: string): string | undefined {
    const quoteMatch = text.match(/["']([^"']+)["']/);
    if (quoteMatch) {
      return quoteMatch[1];
    }

    const keywordMatch = text.match(/\b(?:về|chủ đề|từ khóa|keyword|nội dung)\s+([^?.,;]+)/i);
    if (keywordMatch) {
      return keywordMatch[1].trim();
    }

    return undefined;
  }
}

export const entityResolver = new EntityResolver();
