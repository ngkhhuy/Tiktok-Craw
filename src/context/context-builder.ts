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
import { getVideoStats, getTopHashtags, getVideosByHashtag, getCreatorHashtags, countHashtags, syncAllHashtags, getVideoHashtags, getCreatorHashtagOverview, getDatasetHashtagOverview } from '../storage/database.js';
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
        const isExplicitVideo = /\b(video|clip|bài đăng)\b/i.test(question);
        const isChannel =
          !isExplicitVideo &&
          !plan.entities.creator &&
          (plan.group_by === 'channel' || /\b(channel|kênh|creator)\b/i.test(question));

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

      case 'HASHTAG_ANALYSIS': {
        const hashtagCount = countHashtags();
        if (hashtagCount === 0) {
          syncAllHashtags();
        }

        const requestedVideoId = plan.entities.videoIds && plan.entities.videoIds.length > 0
          ? plan.entities.videoIds[0]
          : undefined;
        const creatorFilter = plan.entities.creator
          ? normalizeCreatorHandle(plan.entities.creator)
          : undefined;
        const hashLimit = plan.entities.limit || 10;
        const hashMetric = plan.entities.metrics[0] === 'likes' ? 'likes'
          : plan.entities.metrics[0] === 'shares' ? 'shares'
          : 'views';

        // ─── SCOPE LEVEL 1: VIDEO SCOPE GUARD (Strict isolation) ───
        if (requestedVideoId) {
          const videoData = getVideoHashtags(requestedVideoId);

          // Evidence Validation: assert evidence.video_id == requested_video_id
          if (!videoData || videoData.video_id !== requestedVideoId) {
            evidence.metrics.hashtag = {
              scope: 'VIDEO',
              video_id: requestedVideoId,
              status: 'REJECT_EVIDENCE',
              message: `REJECT_EVIDENCE: Hashtag evidence mismatch for video ${requestedVideoId}`,
            };
          } else if (!videoData.video_found) {
            evidence.metrics.hashtag = {
              scope: 'VIDEO',
              video_id: requestedVideoId,
              status: 'VIDEO_NOT_FOUND',
              video_found: false,
              has_hashtag_data: false,
              message: `Video ${requestedVideoId} không tồn tại trong tập dữ liệu completed.`,
            };
          } else if (!videoData.has_hashtag_data) {
            // Video exists, but description / hashtag data is absent
            evidence.metrics.hashtag = {
              scope: 'VIDEO',
              video_id: requestedVideoId,
              username: videoData.username,
              status: 'NO_VIDEO_LEVEL_DATA',
              video_found: true,
              has_hashtag_data: false,
              message: `Không có đủ dữ liệu hashtag cho video ${requestedVideoId} để trả lời câu hỏi này.`,
            };
          } else if (videoData.hashtags.length === 0) {
            // Video has description, but contains 0 hashtags (factual absence)
            evidence.metrics.hashtag = {
              scope: 'VIDEO',
              video_id: requestedVideoId,
              username: videoData.username,
              status: 'NO_HASHTAGS_IN_VIDEO',
              video_found: true,
              has_hashtag_data: true,
              hashtags: [],
              message: `Video ${requestedVideoId} có dữ liệu mô tả nhưng không sử dụng hashtag nào.`,
            };
          } else {
            // Video has valid hashtags
            evidence.metrics.hashtag = {
              scope: 'VIDEO',
              video_id: requestedVideoId,
              username: videoData.username,
              status: 'SUCCESS',
              video_found: true,
              has_hashtag_data: true,
              total_hashtags: videoData.hashtags.length,
              hashtags: videoData.hashtags.map((tag, idx) => ({
                hashtag: `#${tag}`,
                position: idx + 1,
              })),
            };
          }

          // Strict Evidence Isolation: never attach external retrieved chunks from other videos or global rankings
          if (evidence.retrieved_chunks && evidence.retrieved_chunks.length > 0) {
            evidence.retrieved_chunks = evidence.retrieved_chunks.filter(
              (c) => c.entity_id === requestedVideoId || c.metadata?.video_id === requestedVideoId
            );
          }

          evidence.data_provenance.source_tables.push('video_hashtags', 'videos');
          break;
        }

        // ─── SCOPE LEVEL 2a: HASHTAG COMPARISON ───
        if (plan.entities.isHashtagComparison && plan.entities.hashtags && plan.entities.hashtags.length >= 2) {
          const tag1 = plan.entities.hashtags[0];
          const tag2 = plan.entities.hashtags[1];
          const targetMetric = plan.entities.metrics[0] || 'views';
          const comp = analyticsEngine.compareHashtags(tag1, tag2, targetMetric, { creator: creatorFilter });

          evidence.metrics.hashtag = {
            scope: creatorFilter ? 'CREATOR' : 'DATASET',
            type: 'COMPARISON',
            comparison: comp,
            display_tag: `${comp.tag1.population.filters.display_tag} vs ${comp.tag2.population.filters.display_tag}`,
            source: 'sqlite',
          };
          evidence.data_provenance.source_tables.push('video_hashtags', 'videos');
          break;
        }

        // ─── SCOPE LEVEL 2b: HASHTAG INTERSECTION ───
        if (plan.entities.isHashtagIntersection && plan.entities.hashtags && plan.entities.hashtags.length >= 2) {
          const targetMetric = plan.entities.metrics[0] || 'views';
          const targetOp = plan.metrics?.[0]?.aggregation || plan.entities.aggregation || 'COUNT';
          const stats = analyticsEngine.getHashtagIntersection(
            plan.entities.hashtags,
            targetOp,
            targetMetric,
            { creator: creatorFilter }
          );

          evidence.metrics.hashtag = {
            scope: creatorFilter ? 'CREATOR' : 'SPECIFIC_HASHTAG',
            type: 'INTERSECTION',
            creator: creatorFilter ? `@${creatorFilter}` : undefined,
            queried_tag: stats.population.filters.display_tag,
            display_tag: stats.population.filters.display_tag,
            normalized_tag: stats.population.filters.normalized_tag,
            operation: targetOp,
            metric: targetMetric,
            population: stats.population,
            aggregation: stats.aggregation,
            video_count: stats.population.count,
            total_views: stats.aggregation.sum,
            avg_views: stats.aggregation.avg,
            min_views: stats.aggregation.min,
            max_views: stats.aggregation.max,
            videos: stats.sample_videos,
            entity_ids: stats.entity_ids,
            source: 'sqlite',
          };

          if (creatorFilter && evidence.retrieved_chunks && evidence.retrieved_chunks.length > 0) {
            evidence.retrieved_chunks = evidence.retrieved_chunks.filter(
              (c) => c.metadata?.username?.toLowerCase() === creatorFilter.toLowerCase()
            );
          }

          evidence.data_provenance.source_tables.push('video_hashtags', 'videos');
          break;
        }

        // ─── SCOPE LEVEL 2c: SPECIFIC HASHTAG LOOKUP & POPULATION AGGREGATION ───
        // (Must precede general creator hashtags when a specific hashtag is queried)
        if (plan.entities.hashtag) {
          const rawTag = plan.entities.displayHashtag || plan.entities.hashtag;
          const displayTag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
          const normalizedTag = plan.entities.hashtag.toLowerCase().replace(/^#/, '').trim();

          const targetMetric = plan.entities.metrics[0] || 'views';
          const targetOp = plan.metrics?.[0]?.aggregation || plan.entities.aggregation || 'SUM';

          const stats = analyticsEngine.getHashtagAnalytics(
            normalizedTag,
            targetOp,
            targetMetric,
            { creator: creatorFilter }
          );

          evidence.metrics.hashtag = {
            scope: creatorFilter ? 'CREATOR' : 'SPECIFIC_HASHTAG',
            creator: creatorFilter ? `@${creatorFilter}` : undefined,
            queried_tag: displayTag,
            display_tag: displayTag,
            normalized_tag: normalizedTag,
            operation: targetOp,
            metric: targetMetric,
            population: stats.population,
            aggregation: stats.aggregation,
            video_count: stats.population.count,
            total_views: stats.aggregation.sum,
            avg_views: stats.aggregation.avg,
            min_views: stats.aggregation.min,
            max_views: stats.aggregation.max,
            videos: stats.sample_videos,
            entity_ids: stats.entity_ids,
            source: 'sqlite',
          };

          if (creatorFilter && evidence.retrieved_chunks && evidence.retrieved_chunks.length > 0) {
            evidence.retrieved_chunks = evidence.retrieved_chunks.filter(
              (c) => c.metadata?.username?.toLowerCase() === creatorFilter.toLowerCase()
            );
          }

          evidence.data_provenance.source_tables.push('video_hashtags', 'videos');
          break;
        }

        // ─── SCOPE LEVEL 3: CREATOR SCOPE GUARD (General creator hashtags, e.g. "top hashtag của @khoailangthang", "có bao nhiêu hashtag?") ───
        if (creatorFilter) {
          const overview = getCreatorHashtagOverview(creatorFilter);
          const topHashtags = getCreatorHashtags(creatorFilter, hashLimit);
          const isCount = plan.entities.aggregation === 'COUNT' || /(bao nhiêu|tổng số|so luong|số lượng|count)/i.test(plan.explanation || '') || /(bao nhiêu|tổng số|so luong|số lượng|count)/i.test(plan.entities.searchTerm || '');

          evidence.metrics.hashtag = {
            scope: 'CREATOR',
            creator: `@${creatorFilter}`,
            status: overview.total_unique_hashtags > 0 ? 'SUCCESS' : 'NO_CREATOR_HASHTAGS',
            is_count_query: isCount,
            total_unique_hashtags: overview.total_unique_hashtags,
            total_hashtag_usages: overview.total_hashtag_usages,
            videos_with_hashtags: overview.videos_with_hashtags,
            top_hashtags: topHashtags,
          };

          if (evidence.retrieved_chunks && evidence.retrieved_chunks.length > 0) {
            evidence.retrieved_chunks = evidence.retrieved_chunks.filter(
              (c) => c.metadata?.username?.toLowerCase() === creatorFilter.toLowerCase()
            );
          }

          evidence.data_provenance.source_tables.push('video_hashtags');
          break;
        }

        // ─── SCOPE LEVEL 4: GLOBAL DATASET SCOPE ───
        const datasetOverview = getDatasetHashtagOverview();
        const topHashtags = getTopHashtags(hashMetric as any, hashLimit);
        const isDatasetCount = plan.entities.aggregation === 'COUNT' || /(bao nhiêu|tổng số|so luong|số lượng|count)/i.test(plan.explanation || '') || /(bao nhiêu|tổng số|so luong|số lượng|count)/i.test(plan.entities.searchTerm || '');

        evidence.metrics.hashtag = {
          scope: 'DATASET',
          metric: hashMetric,
          is_count_query: isDatasetCount,
          total_unique_hashtags: datasetOverview.total_unique_hashtags,
          total_hashtag_usages: datasetOverview.total_hashtag_usages,
          videos_with_hashtags: datasetOverview.videos_with_hashtags,
          top_hashtags: topHashtags,
        };
        evidence.data_provenance.source_tables.push('video_hashtags');
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
