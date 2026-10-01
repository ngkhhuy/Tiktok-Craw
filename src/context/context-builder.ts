/**
 * Context Builder & Evidence Assembler
 * 
 * update2.md Requirements:
 * - "The LLM never directly queries the database or invents numbers"
 * - "The LLM only receives curated Evidence Objects"
 * - "Context Builder strictly formats provenance and statistical evidence"
 */

import { analyticsEngine, VideoAnalyticsDetails, VideoComparisonResult } from '../analytics/analytics-engine.js';
import { getPopulationBaseline } from '../analytics/baseline.js';
import { isDerivedRateMetric, getRateMetricFormula } from '../analytics/metric-definitions.js';
import { normalizeCreatorHandle } from '../query/entity-resolver.js';
import { getVideoStats } from '../storage/database.js';
import { QueryPlan } from '../query/intents.js';
import { RetrievedChunk, semanticRetriever } from '../retrieval/semantic-retriever.js';
import { SWAYSEEK_SYSTEM_PROMPT } from '../rag/prompts.js';

export interface EvidenceObject {
  question: string;
  intent: string;
  plan: QueryPlan;
  metrics: Record<string, any>;
  comparisons?: Record<string, any>;
  benchmarks?: Record<string, any>;
  retrieved_chunks?: RetrievedChunk[];
  data_provenance: {
    source_tables: string[];
    videos_analyzed: number;
    comments_analyzed: number;
    timestamp: string;
  };
}

export class ContextBuilder {
  /**
   * Assembles a structured EvidenceObject from the QueryPlan.
   */
  async buildEvidence(question: string, plan: QueryPlan): Promise<EvidenceObject> {
    const stats = getVideoStats();
    const evidence: EvidenceObject = {
      question,
      intent: plan.intent,
      plan,
      metrics: {},
      data_provenance: {
        source_tables: ['videos'],
        videos_analyzed: stats.total,
        comments_analyzed: stats.totalComments,
        timestamp: new Date().toISOString(),
      },
    };

    switch (plan.intent) {
      case 'METRIC_LOOKUP': {
        const videoId = plan.entities.videoIds[0];
        if (videoId) {
          const videoMetrics = analyticsEngine.getVideoMetrics(videoId);
          if (videoMetrics) {
            evidence.metrics.video = videoMetrics;
            evidence.benchmarks = {
              dataset_baseline: getPopulationBaseline('all_videos'),
            };
            if (videoMetrics.username) {
              evidence.benchmarks.creator_baseline = getPopulationBaseline(`creator:${videoMetrics.username}`);
            }
          } else {
            evidence.metrics.error = `Video ${videoId} was not found in the completed dataset.`;
          }
        }
        break;
      }

      case 'COMPARISON': {
        if (plan.entities.creators && plan.entities.creators.length >= 2) {
          evidence.comparisons = analyticsEngine.compareCreators(
            plan.entities.creators[0],
            plan.entities.creators[1],
            plan.metrics
          ) as any;
        } else if (plan.entities.videoIds.length >= 2) {
          const comp = analyticsEngine.compareVideos(plan.entities.videoIds[0], plan.entities.videoIds[1]);
          if (comp) {
            evidence.comparisons = comp as any;
          } else {
            evidence.comparisons = { error: 'One or both videos could not be loaded for comparison.' };
          }
        } else if (plan.entities.videoIds.length === 1) {
          const videoMetrics = analyticsEngine.getVideoMetrics(plan.entities.videoIds[0]);
          if (videoMetrics) {
            evidence.metrics.video = videoMetrics;
            evidence.benchmarks = {
              dataset_baseline: getPopulationBaseline('all_videos'),
            };
          }
        } else if (plan.entities.creator) {
          evidence.comparisons = analyticsEngine.compareCreatorToBaseline(plan.entities.creator) as any;
        }
        break;
      }

      case 'AGGREGATION': {
        const metricsList =
          plan.metrics && plan.metrics.length > 0
            ? plan.metrics
            : (plan.entities.metrics.length > 0 ? plan.entities.metrics : (['views'] as const)).map((m) => ({
                field: m,
                aggregation: plan.entities.aggregation || 'SUM',
              }));

        const filters = { ...plan.entities.filters };
        if (plan.scope === 'CHANNEL' && plan.entity?.id) {
          filters.creator = normalizeCreatorHandle(plan.entity.id);
        }

        const aggregations: Record<string, any> = {};
        const resultsList: any[] = [];
        const isGlobalRatio =
          plan.metrics?.some((m) => m.aggregation === 'RATIO') ||
          /(?:chiếm bao nhiêu\s*%|chiếm bao nhiêu phần trăm|%\s*tổng|phần trăm tổng|tỉ lệ\s*%|tỷ lệ\s*%|chiếm\s+tỷ\s+lệ|chiếm\s+tỉ\s+lệ)/i.test(question);

        for (const item of metricsList) {
          if (isGlobalRatio || item.aggregation === 'RATIO') {
            const share = analyticsEngine.getChannelShareOfDataset(
              filters.creator || 'all',
              item.field === 'video_id' ? 'views' : item.field,
              'SUM'
            );
            aggregations[item.field] = share;
            resultsList.push({
              metric: item.field,
              aggregation: 'PERCENTAGE_OF_GLOBAL',
              scope: plan.entity?.id || (filters.creator ? `@${normalizeCreatorHandle(filters.creator)}` : 'dataset'),
              channel_value: share.channel_value,
              dataset_value: share.dataset_value,
              value: share.percentage,
              unit: '%',
              summary: share.summary,
            });
          } else {
            const result = analyticsEngine.getAggregate(
              item.field,
              item.aggregation,
              filters,
              plan.entities.percentileTarget
            );
            aggregations[item.field] = result;
            const isRate = isDerivedRateMetric(item.field);
            resultsList.push({
              metric: item.field,
              aggregation: item.aggregation,
              scope: plan.entity?.id || (filters.creator ? `@${normalizeCreatorHandle(filters.creator)}` : 'dataset'),
              value: result.value,
              formula: isRate ? getRateMetricFormula(item.field, item.aggregation) : undefined,
              unit: isRate ? '%' : undefined,
            });
          }
        }

        evidence.metrics.aggregations = aggregations;
        evidence.metrics.results = resultsList;
        evidence.metrics.aggregation = aggregations[metricsList[0]?.field || 'views'];
        break;
      }

      case 'RANKING': {
        const targetMetric = plan.entities.metrics[0] || 'views';
        const limit = plan.entities.limit || 5;
        const isChannel =
          plan.group_by === 'channel' ||
          /\b(channel|kênh|creator)\b/i.test(question) ||
          /\b(channel|kênh|creator)\b/i.test(plan.explanation);

        if (isChannel) {
          const topCreators = analyticsEngine.getTopCreators(
            targetMetric === 'likes' ? 'likes' : targetMetric === 'comments' ? 'comments' : 'views',
            limit,
            plan.entities.order
          );
          evidence.metrics.ranking = {
            target: 'creator',
            metric: targetMetric,
            order: plan.entities.order,
            creators: topCreators,
          };
        } else {
          const topVideos = analyticsEngine.getTopVideos(targetMetric, limit, plan.entities.filters, plan.entities.order);
          evidence.metrics.ranking = {
            target: 'video',
            metric: targetMetric,
            order: plan.entities.order,
            videos: topVideos.map((v) => ({
              video_id: v.video_id,
              username: v.username,
              display_name: v.display_name,
              description: v.description,
              published_at: v.published_at,
              views: v.views,
              likes: v.likes,
              comments: v.comments_count,
              shares: v.shares,
              like_rate: v.like_rate,
              engagement_rate: v.engagement_rate,
              duration: v.duration,
              tiktok_url: `https://www.tiktok.com/@${v.username}/video/${v.video_id}`,
            })),
          };
        }
        break;
      }

      case 'CORRELATION': {
        const metricX = plan.entities.metrics[0] || 'duration';
        const metricY = plan.entities.metrics[1] || 'views';
        const corr = analyticsEngine.getMetricCorrelation(metricX, metricY, plan.entities.filters);
        evidence.metrics.correlation = corr;
        break;
      }

      case 'CREATOR_ANALYSIS': {
        const creator = plan.entities.creator || 'beernary';
        const comp = analyticsEngine.compareCreatorToBaseline(creator);
        const topVideos = analyticsEngine.getTopVideos('views', 3, { creator });
        evidence.metrics.creator_analysis = {
          ...comp,
          top_videos: topVideos.map((v) => ({
            video_id: v.video_id,
            views: v.views,
            likes: v.likes,
            comments: v.comments_count,
            description: v.description,
            tiktok_url: `https://www.tiktok.com/@${v.username}/video/${v.video_id}`,
          })),
        };
        break;
      }

      case 'HYBRID': {
        const videoId = plan.entities.videoIds[0];
        if (videoId) {
          const videoMetrics = analyticsEngine.getVideoMetrics(videoId);
          if (videoMetrics) {
            evidence.metrics.video = videoMetrics;
          }
          const commentSummary = analyticsEngine.getVideoCommentsSummary(videoId, 5);
          evidence.metrics.comment_summary = commentSummary;
          const chunks = await semanticRetriever.retrieve(question, { limit: 5, videoId });
          evidence.retrieved_chunks = chunks;
          evidence.data_provenance.source_tables.push('comments');
        }
        break;
      }

      case 'SEMANTIC_SEARCH': {
        const chunks = await semanticRetriever.retrieve(question, { limit: plan.entities.limit || 6 });
        evidence.retrieved_chunks = chunks;
        evidence.data_provenance.source_tables.push('comments');
        break;
      }

      case 'DATASET_OVERVIEW':
      default: {
        evidence.metrics.dataset = stats;
        evidence.benchmarks = {
          dataset_baseline: getPopulationBaseline('all_videos'),
        };
        break;
      }
    }

    return evidence;
  }

  /**
   * Formats the prompt and strict instructions for the LLM.
   */
  buildPrompt(evidence: EvidenceObject): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = SWAYSEEK_SYSTEM_PROMPT;

    const userPrompt = `USER QUESTION:
${evidence.question}

DETERMINISTIC EVIDENCE OBJECT:
\`\`\`json
${JSON.stringify(evidence, null, 2)}
\`\`\`

Please answer the user's question clearly, citing the exact numbers and findings from the Evidence Object above.`;

    return { systemPrompt, userPrompt };
  }
}

export const contextBuilder = new ContextBuilder();
