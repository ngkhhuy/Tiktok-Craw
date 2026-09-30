/**
 * Query Planner for TikTok Analytics RAG
 * 
 * Maps natural language user questions into deterministic execution plans.
 * update2.md Requirement:
 * - "Deterministic query plan generation"
 * - "The query planner never queries the database blindly or relies on external LLM for math"
 */

import { ContextHistory, entityResolver } from './entity-resolver.js';
import { QueryIntent, QueryPlan } from './intents.js';

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
    else if (
      /(tương quan|ảnh hưởng|càng .* càng|dài hơn .* view hơn|liên quan giữa|có mối liên hệ|có liên hệ)/i.test(lower) ||
      (entities.metrics.length >= 2 && /(và|với|liên hệ|ảnh hưởng)/i.test(lower) && !entities.videoIds.length)
    ) {
      intent = 'CORRELATION';
      const metricX = entities.metrics[0] || 'duration';
      const metricY = entities.metrics[1] || 'views';
      execution_steps.push(`Calculate Pearson correlation r between '${metricX}' and '${metricY}'`);
      execution_steps.push('Attach statistical caveats: correlation is not causation');
      explanation = `Statistical correlation analysis between ${metricX} and ${metricY}.`;
    }
    // 3. Comparison Queries (2 video IDs or comparison wording)
    else if (
      entities.videoIds.length >= 2 ||
      (/(so sánh|khác nhau|hơn hay kém|ai cao hơn|video nào tốt hơn)/i.test(lower) &&
        (entities.videoIds.length === 1 || entities.creator))
    ) {
      intent = 'COMPARISON';
      if (entities.videoIds.length >= 2) {
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
    // 4. Single Video Metric Lookup
    else if (entities.videoIds.length === 1 && !/(bình luận|comment|nói gì|khen|chê|phản hồi)/i.test(lower)) {
      intent = 'METRIC_LOOKUP';
      execution_steps.push(`Fetch record for video '${entities.videoIds[0]}' from videos table`);
      execution_steps.push('Compute deterministic rates (like_rate, comment_rate, share_rate, engagement_rate)');
      execution_steps.push('Calculate rank and percentile against dataset and creator baselines');
      explanation = `Deterministic metric lookup for video ${entities.videoIds[0]}.`;
    }
    // 5. Creator Performance Analysis
    else if (entities.creator && /(hiệu suất|kênh|tổng quan kênh|phát triển|đánh giá|thành tích)/i.test(lower)) {
      intent = 'CREATOR_ANALYSIS';
      execution_steps.push(`Compute baseline benchmark for creator '@${entities.creator}'`);
      execution_steps.push(`Compare creator metrics to overall dataset baseline`);
      execution_steps.push(`Fetch top 3 videos of creator '@${entities.creator}'`);
      explanation = `Creator performance analysis for @${entities.creator}.`;
    }
    // 6. Ranking Queries (Top / Bottom, video nhiều nhất/ít nhất, danh sách xếp hạng)
    else if (
      entities.isRanking ||
      /\b(top|bottom|video nào|những video|danh sách video|video có .* nhất|video nhiều .* nhất|video ít .* nhất)\b/i.test(lower)
    ) {
      intent = 'RANKING';
      const targetMetric = entities.metrics[0] || 'views';
      execution_steps.push(
        `Execute getTopVideos('${targetMetric}', ${entities.limit}, filters, '${entities.order}')`
      );
      explanation = `Retrieve ${entities.order === 'DESC' ? 'top' : 'bottom'} ${entities.limit} videos by ${targetMetric}.`;
    }
    // 7. Aggregation Queries (SUM, AVG, MEDIAN, MIN, MAX, COUNT)
    else if (entities.aggregation) {
      intent = 'AGGREGATION';
      const targetMetric = entities.metrics[0] || 'views';
      execution_steps.push(
        `Execute deterministic getAggregate('${targetMetric}', '${entities.aggregation}', filters)`
      );
      explanation = `Calculate ${entities.aggregation} of ${targetMetric} across matched videos.`;
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

    return {
      intent,
      entities,
      execution_steps,
      explanation,
    };
  }
}

export const queryPlanner = new QueryPlanner();
