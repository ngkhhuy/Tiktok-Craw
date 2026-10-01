/**
 * Query Planner for TikTok Analytics RAG
 * 
 * Maps natural language user questions into deterministic execution plans.
 * update2.md Requirement:
 * - "Deterministic query plan generation"
 * - "The query planner never queries the database blindly or relies on external LLM for math"
 */

import { ContextHistory, entityResolver, normalizeEntityIdentifier } from './entity-resolver.js';
import { MetricAggregationPlan, QueryIntent, QueryPlan } from './intents.js';
import { getRateMetricFormula } from '../analytics/metric-definitions.js';

export class QueryPlanner {
  plan(query: string, context?: ContextHistory): QueryPlan {
    const lower = query.toLowerCase();
    const entities = entityResolver.resolve(query, context);

    let intent: QueryIntent = 'SEMANTIC_SEARCH';
    const execution_steps: string[] = [];
    let explanation = '';

    // 1. Dataset Overview Queries
    if (
      /\b(bao nhiêu video trong database|thống kê database|toàn bộ dữ liệu|tổng quan dữ liệu|hệ thống có bao nhiêu)\b/i.test(
        lower
      )
    ) {
      intent = 'DATASET_OVERVIEW';
      execution_steps.push('Execute getVideoStats() from SQLite database');
      execution_steps.push('Compute dataset-wide baseline benchmarks');
      explanation = 'Overview of total videos, profiles, comments, and views in database.';
    }
    // 2. Correlation Queries
    // STRICT RULE: Only classify as CORRELATION when user genuinely asks about correlation, relationships, or causation.
    // NEVER deduce: 2 metrics → CORRELATION!
    else if (
      /(tương quan|correlation|relationship|mối quan hệ|mức độ liên hệ|có liên quan|liên quan giữa|ảnh hưởng đến|càng .* càng|dài hơn .* view hơn)/i.test(
        lower
      ) ||
      (/(liên quan|liên hệ)/i.test(lower) && /(không|khong|\?)/i.test(lower))
    ) {
      intent = 'CORRELATION';
      const metricX = entities.metrics[0] || 'duration';
      const metricY = entities.metrics[1] || 'views';
      execution_steps.push(`Calculate Pearson correlation r between '${metricX}' and '${metricY}'`);
      execution_steps.push('Attach statistical caveats: correlation is not causation');
      explanation = `Statistical correlation analysis between ${metricX} and ${metricY}.`;
    }
    // 3. Comparison Queries (2 creators, 2 video IDs, or comparison wording)
    else if (
      entities.videoIds.length >= 2 ||
      (entities.creators && entities.creators.length >= 2) ||
      (/\b(so sánh|khác nhau|hơn hay kém|ai cao hơn|video nào tốt hơn|nhiều hơn|ít hơn|cao hơn|thấp hơn|hơn không)\b/i.test(lower) &&
        (entities.videoIds.length >= 1 || (entities.creators && entities.creators.length >= 1) || entities.creator))
    ) {
      intent = 'COMPARISON';
      if (entities.creators && entities.creators.length >= 2) {
        execution_steps.push(
          `Execute deterministic compareCreators('${entities.creators[0]}', '${entities.creators[1]}')`
        );
      } else if (entities.videoIds.length >= 2) {
        execution_steps.push(
          `Execute deterministic compareVideos('${entities.videoIds[0]}', '${entities.videoIds[1]}')`
        );
      } else if (entities.videoIds.length === 1) {
        execution_steps.push(
          `Execute getVideoMetrics('${entities.videoIds[0]}') and compare against population baseline`
        );
      } else if (entities.creator) {
        execution_steps.push(`Execute compareCreatorToBaseline('${entities.creator}')`);
      }
      explanation = 'Side-by-side deterministic comparison with absolute and relative differences.';
    }
    // 4. Ranking Queries (Top / Bottom, video nhiều nhất/ít nhất, danh sách xếp hạng, channel nào có nhiều views nhất)
    else if (
      entities.isRanking ||
      /\b(top|bottom|video nào|những video|danh sách video|kênh nào|channel nào|creator nào)\b/i.test(lower) ||
      /\b(nhiều|ít|cao|thấp)\s+\S+\s+nhất\b/i.test(lower)
    ) {
      intent = 'RANKING';
      const targetMetric = entities.metrics[0] || 'views';
      const isVideoExplicit = /\b(video|clip|bài đăng)\b/i.test(lower);
      const isChannel = !isVideoExplicit && !entities.creator && /\b(channel|kênh|creator|tác giả)\b/i.test(lower);
      if (isChannel) {
        execution_steps.push(`Execute getTopCreators('${targetMetric}', ${entities.limit}, '${entities.order}')`);
        explanation = `Retrieve ${entities.order === 'DESC' ? 'top' : 'bottom'} ${entities.limit} channels by ${targetMetric}.`;
      } else {
        execution_steps.push(
          `Execute getTopVideos('${targetMetric}', ${entities.limit}, filters, '${entities.order}')`
        );
        explanation = `Retrieve ${entities.order === 'DESC' ? 'top' : 'bottom'} ${entities.limit} videos by ${targetMetric}${entities.creator ? ` for creator @${entities.creator}` : ''}.`;
      }
    }
    // 5. Single Video Metric Lookup (when a specific single video ID is provided)
    else if (entities.videoIds.length === 1 && !/(bình luận|comment|nói gì|khen|chê|phản hồi)/i.test(lower)) {
      intent = 'METRIC_LOOKUP';
      execution_steps.push(`Fetch record for video '${entities.videoIds[0]}' from videos table`);
      execution_steps.push('Compute deterministic rates (like_rate, comment_rate, share_rate, engagement_rate)');
      execution_steps.push('Calculate rank and percentile against dataset and creator baselines');
      explanation = `Deterministic metric lookup for video ${entities.videoIds[0]}.`;
    }
    // 6. Creator Performance Qualitative Analysis (e.g. "đánh giá kênh", "hiệu suất kênh")
    else if (entities.creator && /(hiệu suất|tổng quan kênh|phát triển|đánh giá|thành tích)/i.test(lower)) {
      intent = 'CREATOR_ANALYSIS';
      execution_steps.push(`Compute baseline benchmark for creator '@${entities.creator}'`);
      execution_steps.push(`Compare creator metrics to overall dataset baseline`);
      execution_steps.push(`Fetch top 3 videos of creator '@${entities.creator}'`);
      explanation = `Creator performance analysis for @${entities.creator}.`;
    }
    // 7. Aggregation Queries (SUM, AVG, MEDIAN, MIN, MAX, COUNT, multi-metric queries, percentage of global)
    else if (
      entities.aggregation ||
      entities.creator ||
      /(?:bao nhiêu|có bao nhiêu|tổng|tổng cộng|trung bình|chiếm bao nhiêu\s*%|chiếm bao nhiêu phần trăm|%\s*tổng|phần trăm tổng)/i.test(lower)
    ) {
      intent = 'AGGREGATION';
      const plans =
        entities.metricPlans && entities.metricPlans.length > 0
          ? entities.metricPlans
          : entities.metrics.map((m) => ({ field: m, aggregation: entities.aggregation || 'SUM' }));

      for (const p of plans) {
        if (p.aggregation === 'RATIO' || /(?:chiếm bao nhiêu\s*%|chiếm bao nhiêu phần trăm|%\s*tổng|phần trăm tổng)/i.test(lower)) {
          execution_steps.push(
            `Execute deterministic getChannelShareOfDataset('${entities.creator}', '${p.field}', 'SUM')`
          );
        } else {
          execution_steps.push(`Execute deterministic getAggregate('${p.field}', '${p.aggregation}', filters)`);
        }
      }
      explanation = `Calculate exact requested metrics [${plans.map((p) => getRateMetricFormula(p.field, p.aggregation)).join(', ')}] across ${entities.creator ? `channel @${entities.creator}` : 'matched videos'}.`;
    }
    // 8. Hybrid (both metrics and comments requested)
    else if (
      entities.videoIds.length === 1 &&
      /\b(bình luận|comment|nói gì|ý kiến|phản hồi)\b/i.test(lower) &&
      entities.metrics.length > 0
    ) {
      intent = 'HYBRID';
      execution_steps.push(`Execute getVideoMetrics('${entities.videoIds[0]}')`);
      execution_steps.push(`Retrieve top comments and semantic search comments for video '${entities.videoIds[0]}'`);
      explanation = `Hybrid analysis combining video metrics with comment evidence.`;
    }
    // 9. Semantic / Comment Search
    else {
      intent = 'SEMANTIC_SEARCH';
      execution_steps.push(`Generate query vector embedding with embeddingService`);
      execution_steps.push(`Search vectorStore for top semantic matches`);
      execution_steps.push(`Apply MMR diversity filtering`);
      explanation = `Semantic search across comments and captions for evidence matching query.`;
    }

    const scope: 'CHANNEL' | 'VIDEO' | 'DATASET' = entities.videoIds.length > 0
      ? 'VIDEO'
      : entities.creator
      ? 'CHANNEL'
      : 'DATASET';

    const entity: QueryPlan['entity'] = entities.videoIds.length > 0
      ? {
          type: 'VIDEO',
          id: entities.videoIds[0],
        }
      : entities.creator
      ? {
          type: 'CHANNEL',
          id: normalizeEntityIdentifier(entities.creator),
        }
      : null;

    const defaultAgg = entities.aggregation || 'SUM';
    const metrics: MetricAggregationPlan[] =
      entities.metricPlans && entities.metricPlans.length > 0
        ? entities.metricPlans
        : entities.metrics.map((field) => ({
            field,
            aggregation: defaultAgg,
          }));

    const isVideoExplicit = /\b(video|clip|bài đăng)\b/i.test(lower);
    const isChannelRanking =
      intent === 'RANKING' &&
      !isVideoExplicit &&
      !entities.creator &&
      /\b(channel|kênh|creator|tác giả)\b/i.test(lower);
    const group_by = isChannelRanking ? 'channel' : null;

    return {
      intent,
      entity,
      metrics,
      scope,
      group_by,
      entities,
      execution_steps,
      explanation,
    };
  }
}

export const queryPlanner = new QueryPlanner();
