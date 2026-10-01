/**
 * Entity Resolver for TikTok Analytics Queries
 * 
 * Extracts video IDs, URLs, creator handles, metrics, and temporal/statistical filters
 * from Vietnamese and English natural language user queries.
 */

import { parseTikTokUrl } from '../acquisition/tiktok/parser.js';
import { AggregationType, isDerivedRateMetric, MetricAggregationPlan, SupportedMetric } from '../analytics/metric-definitions.js';
import { ResolvedEntities } from './intents.js';

export interface ContextHistory {
  lastVideoIds?: string[];
  lastCreator?: string;
  lastMetric?: SupportedMetric;
}

/**
 * Normalizes entity identifier (creator handle):
 * - trims whitespace
 * - normalizes repeated whitespace
 * - preserves leading '@'
 * - lowercases
 * - removes leading/trailing punctuation (. , ! ? : ; ' " ) ] } / \ ~ ` * ^ - _)
 *
 * Example:
 * "@khoailangthang."  -> "@khoailangthang"
 * "@khoailangthang, " -> "@khoailangthang"
 * "@khoailangthang!"  -> "@khoailangthang"
 * "@khoailangthang?"  -> "@khoailangthang"
 */
export function normalizeEntityIdentifier(raw: string): string {
  if (!raw) return '';
  let str = raw.trim();
  const hasAt = str.startsWith('@') || /^\s*@/.test(str);
  let clean = str
    .replace(/^[.,!?:;'"\)\]\}\/\\~`*^_\-\s@]+/, '')
    .replace(/[.,!?:;'"\)\]\}\/\\~`*^_\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!clean) return '';
  return hasAt ? `@${clean}` : `@${clean}`;
}

/**
 * Normalizes creator handle to pure username (without '@') for database lookups and baselines.
 */
export function normalizeCreatorHandle(raw: string): string {
  const normalized = normalizeEntityIdentifier(raw);
  return normalized.replace(/^@/, '');
}

export class EntityResolver {
  /**
   * Resolves entities from text and optional conversation history.
   */
  resolve(text: string, context?: ContextHistory): ResolvedEntities {
    const videoIds = this.extractVideoIds(text, context);
    const creators = this.extractCreators(text, context);
    const creator = creators[0] || undefined;
    const metrics = this.extractMetrics(text);
    const aggregation = this.extractAggregation(text);
    const resolvedMetrics = metrics.length > 0 ? metrics : (['views'] as SupportedMetric[]);
    const metricPlans = this.extractMetricPlans(text, resolvedMetrics, aggregation);
    const { isRanking, limit, order } = this.extractRankingParameters(text);
    const searchTerm = this.extractSearchTerm(text);

    return {
      videoIds,
      creator,
      creators,
      metrics: resolvedMetrics,
      aggregation,
      metricPlans,
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
   * Extracts creator usernames (@username or "kênh X"). Supports multiple creators for comparisons.
   * Normalizes handles by trimming punctuation (e.g. trailing . , ! ? : ;) and whitespace.
   */
  private extractCreators(text: string, context?: ContextHistory): string[] {
    const list: string[] = [];
    const handleMatches = Array.from(text.matchAll(/@([a-zA-Z0-9_.-]+)/g)).map((m) => m[1]);
    for (const h of handleMatches) {
      const clean = normalizeCreatorHandle(h);
      if (clean && clean.length > 1 && !list.includes(clean)) {
        list.push(clean);
      }
    }

    const channelMatches = Array.from(
      text.matchAll(/(?:kênh|creator|tác giả|channel)\s+@?([^\s,?.!]+)/gi)
    ).map((m) => m[1]);
    for (const c of channelMatches) {
      const clean = normalizeCreatorHandle(c);
      const ascii = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const isInterrogative = ['nao', 'n', 'gi', 'ai', 'dau', 'sao', 'may', 'bao_nhieu', 'nhieu', 'do', 'nay', 'kia'].includes(ascii);
      if (!isInterrogative && clean.length > 1 && !list.includes(clean)) {
        list.push(clean);
      }
    }

    if (list.length === 0 && context?.lastCreator) {
      const lower = text.toLowerCase();
      if (/(kênh đó|creator đó|kênh này|kênh|họ|ông này)/i.test(lower)) {
        const cleanContext = normalizeCreatorHandle(context.lastCreator);
        if (cleanContext && !list.includes(cleanContext)) {
          list.push(cleanContext);
        }
      }
    }

    return list;
  }

  /**
   * Identifies metrics referenced in the query in the order they appear.
   * Evaluates derived rate metrics first to prevent substring collision with raw metrics (e.g. "share rate" vs "shares").
   */
  private extractMetrics(text: string): SupportedMetric[] {
    const lower = text.toLowerCase();
    const found: { metric: SupportedMetric; index: number; length: number }[] = [];

    // Check for video count inquiries (e.g. "bao nhiêu video", "số video", "số lượng video")
    const videoMatch = lower.search(/\b(bao nhiêu video|mấy video|số lượng video|số video|đếm video|tổng số video)\b/);
    if (videoMatch !== -1) {
      found.push({ metric: 'video_id', index: videoMatch, length: 14 });
    }

    // 1. Derived Rate Metrics (matched FIRST to capture full phrases like "share rate", "tỉ lệ chia sẻ")
    const rateMatchers: { metric: SupportedMetric; regex: RegExp }[] = [
      {
        metric: 'share_rate',
        regex: /\b(share[_\s]*rate|tỉ lệ\s*(?:chia sẻ|share)|tỷ lệ\s*(?:chia sẻ|share)|rate\s*share)\b/i,
      },
      {
        metric: 'like_rate',
        regex: /\b(like[_\s]*rate|tỉ lệ\s*(?:like|thích|tim)|tỷ lệ\s*(?:like|thích|tim)|rate\s*like)\b/i,
      },
      {
        metric: 'comment_rate',
        regex: /\b(comment[_\s]*rate|cmt[_\s]*rate|tỉ lệ\s*(?:comment|bình luận|cmt|bl)|tỷ lệ\s*(?:comment|bình luận|cmt|bl))\b/i,
      },
      {
        metric: 'save_rate',
        regex: /\b(save[_\s]*rate|tỉ lệ\s*(?:save|lưu)|tỷ lệ\s*(?:save|lưu))\b/i,
      },
      {
        metric: 'engagement_rate',
        regex: /\b(engagement[_\s]*rate|tỉ lệ\s*(?:tương tác|engagement)|tỷ lệ\s*(?:tương tác|engagement)|mức độ tương tác)\b/i,
      },
    ];

    const matchedSpans: { start: number; end: number }[] = [];

    for (const item of rateMatchers) {
      const match = item.regex.exec(lower);
      if (match) {
        found.push({ metric: item.metric, index: match.index, length: match[0].length });
        matchedSpans.push({ start: match.index, end: match.index + match[0].length });
      }
    }

    // 2. Raw Metrics (Must NOT overlap with matched rate spans)
    const rawMatchers: { metric: SupportedMetric; regex: RegExp }[] = [
      { metric: 'views', regex: /\b(view|lượt xem|lượt view|xem|views)\b/i },
      { metric: 'likes', regex: /\b(like|tim|thích|lượt thích|lượt tim|likes)\b/i },
      { metric: 'comments', regex: /\b(comment|bình luận|bl|cmt|comments)\b/i },
      { metric: 'shares', regex: /\b(share|chia sẻ|lượt share|shares)\b/i },
      { metric: 'saves', regex: /\b(save|lưu|bookmark|saves)\b/i },
      { metric: 'duration', regex: /\b(thời lượng|độ dài|dài bao lâu|duration|thời gian video|số giây)\b/i },
      { metric: 'engagement_rate', regex: /\b(engagement|tương tác)\b/i },
    ];

    for (const item of rawMatchers) {
      const match = item.regex.exec(lower);
      if (match) {
        const start = match.index;
        const end = match.index + match[0].length;
        const overlaps = matchedSpans.some(
          (span) => (start >= span.start && start < span.end) || (end > span.start && end <= span.end)
        );
        if (!overlaps) {
          found.push({ metric: item.metric, index: match.index, length: match[0].length });
        }
      }
    }

    found.sort((a, b) => a.index - b.index);
    const seen = new Set<SupportedMetric>();
    const result: SupportedMetric[] = [];
    for (const f of found) {
      if (!seen.has(f.metric)) {
        seen.add(f.metric);
        result.push(f.metric);
      }
    }

    return result;
  }

  /**
   * Determines the exact aggregation operation for each requested metric.
   * Prevents substituting available statistics (e.g. mean, median, count) for requested metric.
   * Treats derived rate metrics (share_rate, like_rate, etc.) separately from raw count/sum fields.
   */
  private extractMetricPlans(
    text: string,
    metrics: SupportedMetric[],
    overallAgg?: AggregationType
  ): MetricAggregationPlan[] {
    const lower = text.toLowerCase();
    const plans: MetricAggregationPlan[] = [];

    // Split text into clauses by conjunctions / separators
    const clauses = lower.split(/[,;\n]|\b(?:và|với|and|cùng với)\b/i);

    const isGlobalRatio =
      /(?:chiếm bao nhiêu\s*%|chiếm bao nhiêu phần trăm|%\s*tổng|phần trăm tổng|tỉ lệ\s*%|tỷ lệ\s*%|chiếm\s+tỷ\s+lệ|chiếm\s+tỉ\s+lệ)/i.test(lower);

    for (const metric of metrics) {
      if (metric === 'video_id' || metric === 'videos') {
        plans.push({ field: metric, aggregation: 'COUNT' });
        continue;
      }

      if (isGlobalRatio) {
        plans.push({ field: metric, aggregation: 'RATIO' });
        continue;
      }

      const isRate = isDerivedRateMetric(metric);

      // Find the specific clause containing this metric keyword
      const metricPatterns: Record<string, RegExp> = {
        views: /\b(view|lượt xem|lượt view|xem|views)\b/i,
        likes: /\b(like|tim|thích|lượt thích|lượt tim|likes)\b/i,
        comments: /\b(comment|bình luận|bl|cmt|comments)\b/i,
        shares: /\b(share|chia sẻ|lượt share|shares)\b/i,
        saves: /\b(save|lưu|bookmark|saves)\b/i,
        duration: /\b(thời lượng|độ dài|dài bao lâu|duration)\b/i,
        share_rate: /\b(share[_\s]*rate|tỉ lệ\s*(?:chia sẻ|share)|tỷ lệ\s*(?:chia sẻ|share)|rate\s*share)\b/i,
        like_rate: /\b(like[_\s]*rate|tỉ lệ\s*(?:like|thích|tim)|tỷ lệ\s*(?:like|thích|tim)|rate\s*like)\b/i,
        comment_rate: /\b(comment[_\s]*rate|cmt[_\s]*rate|tỉ lệ\s*(?:comment|bình luận|cmt|bl)|tỷ lệ\s*(?:comment|bình luận|cmt|bl))\b/i,
        save_rate: /\b(save[_\s]*rate|tỉ lệ\s*(?:save|lưu)|tỷ lệ\s*(?:save|lưu))\b/i,
        engagement_rate: /\b(engagement[_\s]*rate|tỉ lệ\s*(?:tương tác|engagement)|tỷ lệ\s*(?:tương tác|engagement)|mức độ tương tác|engagement|tương tác)\b/i,
      };

      const pat = metricPatterns[metric];
      let targetClause = clauses.find((c) => pat && pat.test(c)) || lower;

      let agg: AggregationType = isRate ? 'AVG' : 'SUM';

      if (/\b(trung bình|avg|average|bình quân|mỗi video|từng video)\b/i.test(targetClause)) {
        agg = 'AVG';
      } else if (/\b(trung vị|median|ở giữa)\b/i.test(targetClause)) {
        agg = 'MEDIAN';
      } else if (/\b(cao nhất|nhiều nhất|lớn nhất|max)\b/i.test(targetClause)) {
        agg = 'MAX';
      } else if (/\b(thấp nhất|ít nhất|nhỏ nhất|min)\b/i.test(targetClause)) {
        agg = 'MIN';
      } else if (/\b(đếm|count)\b/i.test(targetClause)) {
        agg = 'COUNT';
      } else if (isRate && /\b(toàn kênh|toàn channel|tổng thể|tổng hợp)\b/i.test(targetClause)) {
        agg = 'RATIO';
      } else if (!isRate && /\b(tổng|tổng cộng|sum|toàn bộ|tổng số|bao nhiêu|có bao nhiêu|được bao nhiêu)\b/i.test(targetClause)) {
        agg = 'SUM';
      } else if (overallAgg) {
        if (isRate) {
          agg = overallAgg === 'COUNT' || overallAgg === 'SUM' ? 'AVG' : overallAgg;
        } else {
          agg = overallAgg === 'COUNT' ? 'SUM' : overallAgg;
        }
      }

      plans.push({ field: metric, aggregation: agg });
    }

    return plans;
  }

  /**
   * Identifies mathematical aggregation requested.
   */
  private extractAggregation(text: string): AggregationType | undefined {
    const lower = text.toLowerCase();
    if (/(?:chiếm bao nhiêu\s*%|chiếm bao nhiêu phần trăm|%\s*tổng|phần trăm tổng|tỉ lệ\s*%|tỷ lệ\s*%|chiếm\s+tỷ\s+lệ|chiếm\s+tỉ\s+lệ)/i.test(lower)) return 'RATIO';
    if (/\b(trung bình|avg|average|bình quân)\b/.test(lower)) return 'AVG';
    if (/\b(trung vị|median|ở giữa)\b/.test(lower)) return 'MEDIAN';
    if (/\b(đếm|bao nhiêu video|có mấy video|số lượng video|count)\b/.test(lower)) return 'COUNT';
    if (/\b(tỉ lệ|tỷ lệ|gấp mấy lần|ratio|so sánh tỉ lệ)\b/.test(lower)) return 'RATIO';
    if (/\b(tổng|tổng cộng|sum|toàn bộ|tổng số|bao nhiêu|có bao nhiêu|được bao nhiêu)\b/.test(lower)) return 'SUM';
    if (/\b(cao nhất|nhiều nhất|lớn nhất|max|đỉnh nhất)\b/.test(lower)) return 'MAX';
    if (/\b(thấp nhất|ít nhất|nhỏ nhất|min|kém nhất)\b/.test(lower)) return 'MIN';
    return undefined;
  }

  /**
   * Extracts ranking order and limits (e.g. "top 5 video", "video ít view nhất", "channel nào có nhiều views nhất").
   */
  private extractRankingParameters(text: string): { isRanking: boolean; limit: number; order: 'DESC' | 'ASC' } {
    const lower = text.toLowerCase();
    const hasRankingKeyword =
      /(^|[\s,.\-!?:;"'()\[\]{}#@/\\_])(top|bottom|nhiều nhất|ít nhất|cao nhất|thấp nhất|dẫn đầu|kém nhất|vô địch|bảng xếp hạng|xếp hạng)($|[\s,.\-!?:;"'()\[\]{}#@/\\_])/i.test(
        lower
      ) ||
      /\btop\s*\d+/i.test(lower) ||
      /\bbottom\s*\d+/i.test(lower) ||
      /\b(nhiều|ít|cao|thấp|lớn|nhỏ)\b.*\bnhất\b/i.test(lower) ||
      /\b(channel|kênh|video|clip|ai)\s+nào\b.*\b(nhiều|ít|cao|thấp|nhất)\b/i.test(lower);

    let order: 'DESC' | 'ASC' = 'DESC';
    let limit = 10;

    if (/(ít nhất|thấp nhất|kém nhất|bottom|tệ nhất|ít .* nhất|thấp .* nhất)/i.test(lower)) {
      order = 'ASC';
    }

    const topMatch = lower.match(/(?:top|bottom)\s*(\d+)/i) || lower.match(/(\d+)\s*(?:video|clip|bài|kênh|channel)/i);
    if (topMatch) {
      limit = Math.min(50, Math.max(1, parseInt(topMatch[1], 10)));
    } else if (/(duy nhất|1 video|nhất|dẫn đầu|vô địch|kênh nào|channel nào|video nào)/i.test(lower) && !lower.includes('top')) {
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
