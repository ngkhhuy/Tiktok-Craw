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
import { getVideoStats } from '../storage/database.js';
import { QueryPlan } from '../query/intents.js';
import { RetrievedChunk, semanticRetriever } from '../retrieval/semantic-retriever.js';

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
        if (plan.entities.videoIds.length >= 2) {
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
        const metric = plan.entities.metrics[0] || 'views';
        const agg = plan.entities.aggregation || 'SUM';
        const result = analyticsEngine.getAggregate(metric, agg, plan.entities.filters, plan.entities.percentileTarget);
        evidence.metrics.aggregation = result;
        evidence.benchmarks = {
          dataset_baseline: getPopulationBaseline('all_videos'),
        };
        break;
      }

      case 'RANKING': {
        const targetMetric = plan.entities.metrics[0] || 'views';
        const limit = plan.entities.limit || 5;
        const topVideos = analyticsEngine.getTopVideos(targetMetric, limit, plan.entities.filters, plan.entities.order);
        evidence.metrics.ranking = {
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
    const systemPrompt = `You are a strict, deterministic TikTok Dataset Analytics Assistant.
Your task is to explain and interpret the provided deterministic evidence for the user.

STRICT OPERATIONAL RULES:
1. Ground Truth: The provided Evidence JSON is the ONLY truth. NEVER invent, hallucinate, extrapolate, or guess numbers.
2. Calculations: All numbers, rates, percentiles, and differences are already calculated for you. Do NOT recalculate or modify them.
3. Provenance: Cite exact video IDs, usernames, and metrics from the evidence object.
4. Baseline Context: Never say a metric is "cao" (high) or "thấp" (low) without stating the baseline population and percentile (e.g. "top 10% toàn bộ dataset" or "cao hơn median của kênh").
5. Correlation vs Causation: If discussing correlations, you MUST explicitly state that correlation does NOT imply causation.
6. Identify Specific Videos: When answering rankings, top/bottom performers, or max/min questions, you MUST explicitly point out the specific video(s): state the Video ID, Channel (@username), Caption/Description snippet, Key Metrics, and direct link so the user knows exactly which video is being referred to. Never give just a bare number without pointing to the video!
7. Language: Respond in clear, professional Vietnamese (or English if the user asks in English).
8. Missing Data: If a video or metric is not found in the evidence, clearly report that it is not present in the completed dataset.`;

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
