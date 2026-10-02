/**
 * Deterministic Analytics Engine for TikTok Dataset
 * 
 * update2.md Requirements:
 * - "Database is the Source of Truth"
 * - "Analytics Engine executes deterministic calculations:
 *    COUNT, SUM, AVG, MEDIAN, MIN, MAX, PERCENTILE, RANK, RATIO"
 * - "Never let the LLM calculate important metrics or guess numbers"
 * - "All comparisons must define comparison populations"
 */

import { getDb, getVideoById, getHashtagPopulationAnalytics, getHashtagIntersectionAnalytics, HashtagPopulationStats } from '../storage/database.js';
import {
  AggregationType,
  calculateDifference,
  calculateMedian,
  calculatePearsonCorrelation,
  calculatePercentile,
  calculatePercentileRank,
  calculateRates,
  calculateRatio,
  FilterCriteria,
  MetricAggregationPlan,
  MetricRates,
  SupportedMetric,
} from './metric-definitions.js';
import { getPopulationBaseline } from './baseline.js';
import { normalizeCreatorHandle } from '../query/entity-resolver.js';

export interface VideoAnalyticsDetails {
  video_id: string;
  username: string;
  display_name: string;
  description: string;
  published_at: string | null;
  raw: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    duration: number;
    file_size: number;
  };
  rates: MetricRates;
  ranks: {
    overall: {
      total_videos: number;
      views_rank: number;
      likes_rank: number;
      comments_rank: number;
      engagement_rate_rank: number;
      views_percentile: number;
      likes_percentile: number;
      engagement_percentile: number;
    };
    creator?: {
      total_videos: number;
      views_rank: number;
      likes_rank: number;
      views_percentile: number;
      likes_percentile: number;
    };
  };
  comparison_to_baseline: {
    dataset_median_views: number;
    views_diff: number | null;
    views_percent_diff: number | null;
    dataset_median_engagement_rate: number;
    engagement_diff: number | null;
    engagement_percent_diff: number | null;
  };
}

export interface VideoComparisonResult {
  video_a: {
    video_id: string;
    username: string;
    description: string;
    metrics: Record<string, number | null>;
  };
  video_b: {
    video_id: string;
    username: string;
    description: string;
    metrics: Record<string, number | null>;
  };
  comparison: Record<
    string,
    {
      value_a: number | null;
      value_b: number | null;
      diff: number | null;
      percent_diff: number | null;
      higher: 'video_a' | 'video_b' | 'equal' | 'n/a';
    }
  >;
  summary: string;
}

export class AnalyticsEngine {
  private db = getDb();

  /**
   * Builds SQL WHERE conditions from FilterCriteria.
   */
  private buildFilterClause(filters?: FilterCriteria): { clause: string; params: any[] } {
    const conditions: string[] = ["status = 'completed'"];
    const params: any[] = [];

    if (!filters) {
      return { clause: `WHERE ${conditions.join(' AND ')}`, params };
    }

    if (filters.creator) {
      conditions.push('username = ?');
      params.push(normalizeCreatorHandle(filters.creator));
    }
    if (filters.startDate) {
      conditions.push('published_at >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('published_at <= ?');
      params.push(filters.endDate);
    }
    if (filters.minViews !== undefined) {
      conditions.push('views >= ?');
      params.push(filters.minViews);
    }
    if (filters.maxViews !== undefined) {
      conditions.push('views <= ?');
      params.push(filters.maxViews);
    }
    if (filters.minDuration !== undefined) {
      conditions.push('duration >= ?');
      params.push(filters.minDuration);
    }
    if (filters.maxDuration !== undefined) {
      conditions.push('duration <= ?');
      params.push(filters.maxDuration);
    }
    if (filters.hashtag) {
      const cleanTag = filters.hashtag.toLowerCase().replace(/^#/, '').trim();
      conditions.push('video_id IN (SELECT DISTINCT video_id FROM video_hashtags WHERE hashtag = ?)');
      params.push(cleanTag);
    }
    if (filters.keyword) {
      conditions.push('(description LIKE ? OR username LIKE ?)');
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
    }

    return {
      clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  /**
   * Retrieves full deterministic metrics for a single video.
   */
  getVideoMetrics(videoId: string): VideoAnalyticsDetails | null {
    const row = getVideoById(videoId);
    if (!row) return null;

    const views = Number(row.views) || 0;
    const likes = Number(row.likes) || 0;
    const comments = Number(row.comments_count) || 0;
    const shares = Number(row.shares) || 0;
    const saves = Number(row.saves) || 0;
    const duration = Number(row.duration) || 0;
    const fileSize = Number(row.file_size) || 0;

    const rates = calculateRates({ views, likes, comments, shares, saves });

    // Dataset baseline
    const datasetBaseline = getPopulationBaseline('all_videos');
    const medianViews = datasetBaseline.metrics.views.median;
    const medianEngagement = datasetBaseline.metrics.engagement_rate.median;

    const viewsDiff = calculateDifference(views, medianViews);
    const engDiff = calculateDifference(rates.engagement_rate, medianEngagement);

    // Calculate overall ranks
    const allCompleted = this.db
      .prepare(`SELECT video_id, views, likes, comments_count, shares FROM videos WHERE status = 'completed'`)
      .all() as any[];

    const allViews = allCompleted.map((r) => Number(r.views) || 0);
    const allLikes = allCompleted.map((r) => Number(r.likes) || 0);
    const allEngRates = allCompleted.map((r) => {
      const v = Number(r.views) || 0;
      return v > 0 ? (Number(r.likes) + Number(r.comments_count) + Number(r.shares)) / v : 0;
    });

    const viewsRank = allViews.filter((v) => v > views).length + 1;
    const likesRank = allLikes.filter((l) => l > likes).length + 1;
    const commentsRank = allCompleted.filter((c) => (Number(c.comments_count) || 0) > comments).length + 1;
    const currentEng = rates.engagement_rate || 0;
    const engRank = allEngRates.filter((e) => e > currentEng).length + 1;

    const viewsPercentile = calculatePercentileRank(allViews, views);
    const likesPercentile = calculatePercentileRank(allLikes, likes);
    const engPercentile = calculatePercentileRank(allEngRates, currentEng);

    // Creator specific ranks
    let creatorRankObj: VideoAnalyticsDetails['ranks']['creator'] | undefined = undefined;
    if (row.username) {
      const creatorVideos = this.db
        .prepare(`SELECT views, likes FROM videos WHERE status = 'completed' AND username = ?`)
        .all(row.username) as any[];

      const cViews = creatorVideos.map((r) => Number(r.views) || 0);
      const cLikes = creatorVideos.map((r) => Number(r.likes) || 0);

      creatorRankObj = {
        total_videos: creatorVideos.length,
        views_rank: cViews.filter((v) => v > views).length + 1,
        likes_rank: cLikes.filter((l) => l > likes).length + 1,
        views_percentile: calculatePercentileRank(cViews, views),
        likes_percentile: calculatePercentileRank(cLikes, likes),
      };
    }

    return {
      video_id: row.video_id,
      username: row.username || '',
      display_name: row.display_name || '',
      description: row.description || '',
      published_at: row.published_at || null,
      raw: {
        views,
        likes,
        comments,
        shares,
        saves,
        duration,
        file_size: fileSize,
      },
      rates,
      ranks: {
        overall: {
          total_videos: allCompleted.length,
          views_rank: viewsRank,
          likes_rank: likesRank,
          comments_rank: commentsRank,
          engagement_rate_rank: engRank,
          views_percentile: viewsPercentile,
          likes_percentile: likesPercentile,
          engagement_percentile: engPercentile,
        },
        creator: creatorRankObj,
      },
      comparison_to_baseline: {
        dataset_median_views: medianViews,
        views_diff: viewsDiff.diff,
        views_percent_diff: viewsDiff.percent_change,
        dataset_median_engagement_rate: medianEngagement,
        engagement_diff: engDiff.diff,
        engagement_percent_diff: engDiff.percent_change,
      },
    };
  }

  /**
   * Deterministic aggregation across the dataset.
   */
  getAggregate(
    metric: SupportedMetric,
    agg: AggregationType,
    filters?: FilterCriteria,
    percentileTarget: number = 50
  ): { value: number | null; count: number; metric: SupportedMetric; agg: AggregationType; top_video?: any } {
    const { clause, params } = this.buildFilterClause(filters);

    if (agg === 'COUNT') {
      const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM videos ${clause}`).get(...params) as any;
      return { value: row?.cnt || 0, count: row?.cnt || 0, metric, agg };
    }

    // If MAX or MIN, find the corresponding video record
    let top_video: any = undefined;
    if (agg === 'MAX' || agg === 'MIN') {
      const topList = this.getTopVideos(metric, 1, filters, agg === 'MAX' ? 'DESC' : 'ASC');
      if (topList.length > 0) {
        const v = topList[0];
        top_video = {
          video_id: v.video_id,
          username: v.username,
          display_name: v.display_name,
          description: v.description,
          views: v.views,
          likes: v.likes,
          comments: v.comments_count,
          shares: v.shares,
          duration: v.duration,
          like_rate: v.like_rate,
          engagement_rate: v.engagement_rate,
          published_at: v.published_at,
          tiktok_url: `https://www.tiktok.com/@${v.username}/video/${v.video_id}`,
        };
      }
    }

    // Rate metrics need row-by-row rate calculation
    const isRateMetric = ['like_rate', 'comment_rate', 'share_rate', 'save_rate', 'engagement_rate'].includes(metric);

    if (isRateMetric || agg === 'MEDIAN' || agg === 'PERCENTILE') {
      const rows = this.db
        .prepare(`SELECT views, likes, comments_count, shares, saves, duration FROM videos ${clause}`)
        .all(...params) as any[];

      const values: number[] = [];
      for (const r of rows) {
        const v = Number(r.views) || 0;
        if (metric === 'views') values.push(v);
        else if (metric === 'likes') values.push(Number(r.likes) || 0);
        else if (metric === 'comments') values.push(Number(r.comments_count) || 0);
        else if (metric === 'shares') values.push(Number(r.shares) || 0);
        else if (metric === 'saves') values.push(Number(r.saves) || 0);
        else if (metric === 'duration') values.push(Number(r.duration) || 0);
        else if (v > 0) {
          const rates = calculateRates({
            views: v,
            likes: Number(r.likes) || 0,
            comments: Number(r.comments_count) || 0,
            shares: Number(r.shares) || 0,
            saves: Number(r.saves) || 0,
          });
          const rateVal = rates[metric as keyof MetricRates];
          if (rateVal !== null) values.push(rateVal);
        }
      }

      if (values.length === 0) {
        return { value: null, count: 0, metric, agg, top_video };
      }

      if (agg === 'MEDIAN') {
        return { value: calculateMedian(values), count: values.length, metric, agg, top_video };
      }
      if (agg === 'PERCENTILE') {
        return { value: calculatePercentile(values, percentileTarget), count: values.length, metric, agg, top_video };
      }
      if (isRateMetric && (agg === 'SUM' || agg === 'RATIO')) {
        let totalNum = 0;
        let totalDenom = 0;
        for (const r of rows) {
          const v = Number(r.views) || 0;
          totalDenom += v;
          if (metric === 'share_rate') totalNum += Number(r.shares) || 0;
          else if (metric === 'like_rate') totalNum += Number(r.likes) || 0;
          else if (metric === 'comment_rate') totalNum += Number(r.comments_count) || 0;
          else if (metric === 'save_rate') totalNum += Number(r.saves) || 0;
          else if (metric === 'engagement_rate') totalNum += (Number(r.likes) || 0) + (Number(r.comments_count) || 0) + (Number(r.shares) || 0);
        }
        const aggregateRate = totalDenom > 0 ? totalNum / totalDenom : null;
        return {
          value: aggregateRate !== null ? Number(aggregateRate.toFixed(6)) : null,
          count: rows.length,
          metric,
          agg,
          top_video,
        };
      }

      if (agg === 'SUM') {
        const sum = values.reduce((a, b) => a + b, 0);
        return { value: Number(sum.toFixed(4)), count: values.length, metric, agg, top_video };
      }
      if (agg === 'AVG') {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        return { value: Number(avg.toFixed(isRateMetric ? 6 : 4)), count: values.length, metric, agg, top_video };
      }
      if (agg === 'MIN') {
        return { value: Math.min(...values), count: values.length, metric, agg, top_video };
      }
      if (agg === 'MAX') {
        return { value: Math.max(...values), count: values.length, metric, agg, top_video };
      }
    }

    // Direct SQL column mapping for raw metrics
    const colMap: Record<string, string> = {
      views: 'views',
      likes: 'likes',
      comments: 'comments_count',
      shares: 'shares',
      saves: 'saves',
      duration: 'duration',
      videos: 'video_id',
      video_id: 'video_id',
    };
    const col = colMap[metric] || 'views';

    let sqlAgg = 'SUM';
    if (agg === 'AVG') sqlAgg = 'AVG';
    else if (agg === 'MIN') sqlAgg = 'MIN';
    else if (agg === 'MAX') sqlAgg = 'MAX';

    const row = this.db
      .prepare(`SELECT ${sqlAgg}(${col}) as val, COUNT(*) as cnt FROM videos ${clause}`)
      .get(...params) as any;

    return {
      value: row?.val !== null && row?.val !== undefined ? Number(Number(row.val).toFixed(4)) : null,
      count: row?.cnt || 0,
      metric,
      agg,
      top_video,
    };
  }

  /**
   * Retrieves top N videos sorted by a specific metric.
   */
  getTopVideos(
    metric: SupportedMetric = 'views',
    limit: number = 10,
    filters?: FilterCriteria,
    order: 'DESC' | 'ASC' = 'DESC'
  ): any[] {
    const { clause, params } = this.buildFilterClause(filters);
    const isRateMetric = ['like_rate', 'comment_rate', 'share_rate', 'save_rate', 'engagement_rate'].includes(metric);

    if (isRateMetric) {
      // Rates need in-memory sorting since SQLite does not store computed rates directly in videos table
      const rows = this.db
        .prepare(`SELECT * FROM videos ${clause}`)
        .all(...params) as any[];

      const mapped = rows.map((r) => {
        const rates = calculateRates({
          views: Number(r.views) || 0,
          likes: Number(r.likes) || 0,
          comments: Number(r.comments_count) || 0,
          shares: Number(r.shares) || 0,
          saves: Number(r.saves) || 0,
        });
        return {
          ...r,
          ...rates,
        };
      });

      mapped.sort((a, b) => {
        const valA = a[metric] ?? (order === 'DESC' ? -1 : Infinity);
        const valB = b[metric] ?? (order === 'DESC' ? -1 : Infinity);
        return order === 'DESC' ? valB - valA : valA - valB;
      });

      return mapped.slice(0, limit);
    }

    const colMap: Record<string, string> = {
      views: 'views',
      likes: 'likes',
      comments: 'comments_count',
      shares: 'shares',
      saves: 'saves',
      duration: 'duration',
    };
    const col = colMap[metric] || 'views';

    const sql = `SELECT * FROM videos ${clause} ORDER BY ${col} ${order} LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as any[];

    return rows.map((r) => {
      const rates = calculateRates({
        views: Number(r.views) || 0,
        likes: Number(r.likes) || 0,
        comments: Number(r.comments_count) || 0,
        shares: Number(r.shares) || 0,
        saves: Number(r.saves) || 0,
      });
      return { ...r, ...rates };
    });
  }

  /**
   * Deterministic side-by-side comparison of 2 videos.
   */
  compareVideos(videoIdA: string, videoIdB: string): VideoComparisonResult | null {
    const a = this.getVideoMetrics(videoIdA);
    const b = this.getVideoMetrics(videoIdB);
    if (!a || !b) return null;

    const metricsToCompare: (keyof typeof a.raw | keyof MetricRates)[] = [
      'views',
      'likes',
      'comments',
      'shares',
      'saves',
      'duration',
      'like_rate',
      'comment_rate',
      'share_rate',
      'engagement_rate',
    ];

    const comparison: VideoComparisonResult['comparison'] = {};

    for (const m of metricsToCompare) {
      const valA = (a.raw as any)[m] ?? (a.rates as any)[m] ?? null;
      const valB = (b.raw as any)[m] ?? (b.rates as any)[m] ?? null;

      const { diff, percent_change } = calculateDifference(valB, valA);
      let higher: 'video_a' | 'video_b' | 'equal' | 'n/a' = 'equal';
      if (valA === null || valB === null) higher = 'n/a';
      else if (valA > valB) higher = 'video_a';
      else if (valB > valA) higher = 'video_b';

      comparison[m] = {
        value_a: valA,
        value_b: valB,
        diff,
        percent_diff: percent_change,
        higher,
      };
    }

    const summaryParts: string[] = [];
    if (comparison.views.percent_diff !== null) {
      if (comparison.views.percent_diff > 0) {
        summaryParts.push(`Video B (${b.video_id}) has ${comparison.views.percent_diff}% more views than Video A`);
      } else if (comparison.views.percent_diff < 0) {
        summaryParts.push(`Video A (${a.video_id}) has ${Math.abs(comparison.views.percent_diff)}% more views than Video B`);
      } else {
        summaryParts.push(`Both videos have identical view counts (${a.raw.views})`);
      }
    }

    if (comparison.engagement_rate.value_a !== null && comparison.engagement_rate.value_b !== null) {
      summaryParts.push(
        `Engagement rate: Video A = ${(comparison.engagement_rate.value_a * 100).toFixed(2)}%, Video B = ${(comparison.engagement_rate.value_b * 100).toFixed(2)}%`
      );
    }

    return {
      video_a: {
        video_id: a.video_id,
        username: a.username,
        description: a.description,
        metrics: {
          views: a.raw.views,
          likes: a.raw.likes,
          comments: a.raw.comments,
          shares: a.raw.shares,
          duration: a.raw.duration,
          ...a.rates,
        },
      },
      video_b: {
        video_id: b.video_id,
        username: b.username,
        description: b.description,
        metrics: {
          views: b.raw.views,
          likes: b.raw.likes,
          comments: b.raw.comments,
          shares: b.raw.shares,
          duration: b.raw.duration,
          ...b.rates,
        },
      },
      comparison,
      summary: summaryParts.join('. ') + '.',
    };
  }

  /**
   * Compares a creator's median performance to the overall dataset baseline.
   */
  compareCreatorToBaseline(username: string): {
    creator: string;
    creator_total_videos: number;
    dataset_total_videos: number;
    creator_median_views: number;
    dataset_median_views: number;
    views_percent_diff: number | null;
    creator_median_engagement: number;
    dataset_median_engagement: number;
    engagement_percent_diff: number | null;
  } {
    const cleanUser = normalizeCreatorHandle(username);
    const creatorBaseline = getPopulationBaseline(`creator:${cleanUser}`);
    const datasetBaseline = getPopulationBaseline('all_videos');

    const cViews = creatorBaseline.metrics.views.median;
    const dViews = datasetBaseline.metrics.views.median;
    const viewsDiff = calculateDifference(cViews, dViews);

    const cEng = creatorBaseline.metrics.engagement_rate.median;
    const dEng = datasetBaseline.metrics.engagement_rate.median;
    const engDiff = calculateDifference(cEng, dEng);

    return {
      creator: cleanUser,
      creator_total_videos: creatorBaseline.total_videos,
      dataset_total_videos: datasetBaseline.total_videos,
      creator_median_views: cViews,
      dataset_median_views: dViews,
      views_percent_diff: viewsDiff.percent_change,
      creator_median_engagement: cEng,
      dataset_median_engagement: dEng,
      engagement_percent_diff: engDiff.percent_change,
    };
  }

  /**
   * Compares two creators side-by-side using deterministic metrics and differences.
   * If metricsToCompare is specified, calculates the exact requested operations (e.g. SUM, AVG)
   * instead of defaulting to medians.
   */
  compareCreators(
    creatorA: string,
    creatorB: string,
    metricsToCompare?: MetricAggregationPlan[]
  ): {
    creator_a: {
      username: string;
      total_videos: number;
      median_views: number;
      mean_views: number;
      median_likes: number;
      median_engagement: number;
      aggregated_metrics?: Record<string, { aggregation: string; value: number | null }>;
    };
    creator_b: {
      username: string;
      total_videos: number;
      median_views: number;
      mean_views: number;
      median_likes: number;
      median_engagement: number;
      aggregated_metrics?: Record<string, { aggregation: string; value: number | null }>;
    };
    comparison_rows?: {
      metric: SupportedMetric;
      aggregation: AggregationType;
      value_a: number | null;
      value_b: number | null;
      diff: number | null;
      percent_diff: number | null;
      higher: string;
    }[];
    differences: {
      views_diff: any;
      likes_diff: any;
      engagement_diff: any;
      [key: string]: any;
    };
    summary: string;
  } {
    const userA = normalizeCreatorHandle(creatorA);
    const userB = normalizeCreatorHandle(creatorB);
    const baselineA = getPopulationBaseline(`creator:${userA}`);
    const baselineB = getPopulationBaseline(`creator:${userB}`);

    const viewsDiff = calculateDifference(baselineA.metrics.views.median, baselineB.metrics.views.median);
    const likesDiff = calculateDifference(baselineA.metrics.likes.median, baselineB.metrics.likes.median);
    const engDiff = calculateDifference(baselineA.metrics.engagement_rate.median, baselineB.metrics.engagement_rate.median);

    const aggregatedA: Record<string, { aggregation: string; value: number | null }> = {};
    const aggregatedB: Record<string, { aggregation: string; value: number | null }> = {};
    const comparison_rows: {
      metric: SupportedMetric;
      aggregation: AggregationType;
      value_a: number | null;
      value_b: number | null;
      diff: number | null;
      percent_diff: number | null;
      higher: string;
    }[] = [];

    const customDiffs: {
      views_diff: any;
      likes_diff: any;
      engagement_diff: any;
      [key: string]: any;
    } = {
      views_diff: viewsDiff,
      likes_diff: likesDiff,
      engagement_diff: engDiff,
    };

    let summary = '';

    if (metricsToCompare && metricsToCompare.length > 0) {
      for (const m of metricsToCompare) {
        const resA = this.getAggregate(m.field, m.aggregation, { creator: userA });
        const resB = this.getAggregate(m.field, m.aggregation, { creator: userB });

        const valA = resA.value;
        const valB = resB.value;
        const d = calculateDifference(valA, valB);
        const higher =
          valA !== null && valB !== null
            ? valA > valB
              ? `@${userA}`
              : valB > valA
              ? `@${userB}`
              : 'bằng nhau'
            : 'N/A';

        aggregatedA[m.field] = { aggregation: m.aggregation, value: valA };
        aggregatedB[m.field] = { aggregation: m.aggregation, value: valB };

        comparison_rows.push({
          metric: m.field,
          aggregation: m.aggregation,
          value_a: valA,
          value_b: valB,
          diff: d.diff,
          percent_diff: d.percent_change,
          higher,
        });

        customDiffs[`${m.field}_${m.aggregation.toLowerCase()}_diff`] = d;
      }

      summary =
        `So sánh giữa @${userA} và @${userB}: ` +
        comparison_rows
          .map(
            (r) =>
              `${r.metric} [${r.aggregation}]: @${userA}=${r.value_a?.toLocaleString() ?? 'N/A'}, @${userB}=${r.value_b?.toLocaleString() ?? 'N/A'} (${r.higher} cao hơn)`
          )
          .join('; ');
    } else {
      const higherViews =
        baselineA.metrics.views.median > baselineB.metrics.views.median
          ? `@${userA}`
          : baselineB.metrics.views.median > baselineA.metrics.views.median
          ? `@${userB}`
          : 'bằng nhau';
      summary = `Kênh ${higherViews} có median views cao hơn giữa @${userA} và @${userB}.`;
    }

    return {
      creator_a: {
        username: userA,
        total_videos: baselineA.total_videos,
        median_views: baselineA.metrics.views.median,
        mean_views: baselineA.metrics.views.mean,
        median_likes: baselineA.metrics.likes.median,
        median_engagement: baselineA.metrics.engagement_rate.median,
        aggregated_metrics: aggregatedA,
      },
      creator_b: {
        username: userB,
        total_videos: baselineB.total_videos,
        median_views: baselineB.metrics.views.median,
        mean_views: baselineB.metrics.views.mean,
        median_likes: baselineB.metrics.likes.median,
        median_engagement: baselineB.metrics.engagement_rate.median,
        aggregated_metrics: aggregatedB,
      },
      comparison_rows,
      differences: customDiffs,
      summary,
    };
  }

  /**
   * Computes the channel's share / percentage of the global dataset for a given metric.
   * e.g., SUM(views WHERE channel = @khoailangthang) / SUM(views WHERE all channels) * 100
   */
  getChannelShareOfDataset(
    username: string,
    metric: SupportedMetric = 'views',
    aggregation: 'SUM' | 'COUNT' = 'SUM'
  ): {
    channel: string;
    metric: SupportedMetric;
    aggregation: string;
    channel_value: number;
    dataset_value: number;
    percentage: number;
    total_videos_channel: number;
    total_videos_dataset: number;
    summary: string;
  } {
    const cleanUser = normalizeCreatorHandle(username);
    const channelRes = this.getAggregate(metric, aggregation, { creator: cleanUser });
    const datasetRes = this.getAggregate(metric, aggregation, {});

    const channelVal = channelRes.value || 0;
    const datasetVal = datasetRes.value || 0;
    const percentage = datasetVal > 0 ? Number(((channelVal / datasetVal) * 100).toFixed(2)) : 0;

    return {
      channel: `@${cleanUser}`,
      metric,
      aggregation,
      channel_value: channelVal,
      dataset_value: datasetVal,
      percentage,
      total_videos_channel: channelRes.count,
      total_videos_dataset: datasetRes.count,
      summary: `Kênh @${cleanUser} chiếm ${percentage}% tổng ${metric} của toàn bộ dataset (${channelVal.toLocaleString()} / ${datasetVal.toLocaleString()}).`,
    };
  }

  /**
   * Retrieves top creators aggregated by total views, likes, or video count.
   */
  getTopCreators(
    metric: 'views' | 'likes' | 'comments' = 'views',
    limit: number = 5,
    order: 'DESC' | 'ASC' = 'DESC'
  ): {
    username: string;
    display_name: string;
    total_videos: number;
    total_views: number;
    total_likes: number;
    total_comments: number;
    avg_views: number;
  }[] {
    const col = metric === 'likes' ? 'SUM(v.likes)' : metric === 'comments' ? 'SUM(v.comments_count)' : 'SUM(v.views)';
    const sql = `
      SELECT 
        v.username,
        MAX(v.display_name) as display_name,
        COUNT(v.video_id) as total_videos,
        SUM(v.views) as total_views,
        SUM(v.likes) as total_likes,
        SUM(v.comments_count) as total_comments,
        ROUND(AVG(v.views), 1) as avg_views
      FROM videos v
      WHERE v.status = 'completed' AND v.username IS NOT NULL AND v.username != ''
      GROUP BY v.username
      ORDER BY ${col} ${order}
      LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(limit) as any[];
    return rows.map((r) => ({
      username: r.username,
      display_name: r.display_name || r.username,
      total_videos: Number(r.total_videos) || 0,
      total_views: Number(r.total_views) || 0,
      total_likes: Number(r.total_likes) || 0,
      total_comments: Number(r.total_comments) || 0,
      avg_views: Number(r.avg_views) || 0,
    }));
  }

  /**
   * Computes Pearson correlation between two metrics.
   */
  getMetricCorrelation(
    metricX: SupportedMetric,
    metricY: SupportedMetric,
    filters?: FilterCriteria
  ) {
    const { clause, params } = this.buildFilterClause(filters);
    const rows = this.db
      .prepare(`SELECT views, likes, comments_count, shares, saves, duration FROM videos ${clause}`)
      .all(...params) as any[];

    const extractMetric = (row: any, m: SupportedMetric): number | null => {
      const v = Number(row.views) || 0;
      if (m === 'views') return v;
      if (m === 'likes') return Number(row.likes) || 0;
      if (m === 'comments') return Number(row.comments_count) || 0;
      if (m === 'shares') return Number(row.shares) || 0;
      if (m === 'saves') return Number(row.saves) || 0;
      if (m === 'duration') return Number(row.duration) || 0;
      if (v > 0) {
        const rates = calculateRates({
          views: v,
          likes: Number(row.likes) || 0,
          comments: Number(row.comments_count) || 0,
          shares: Number(row.shares) || 0,
          saves: Number(row.saves) || 0,
        });
        return rates[m as keyof MetricRates];
      }
      return null;
    };

    const xVals: number[] = [];
    const yVals: number[] = [];

    for (const r of rows) {
      const x = extractMetric(r, metricX);
      const y = extractMetric(r, metricY);
      if (x !== null && y !== null) {
        xVals.push(x);
        yVals.push(y);
      }
    }

    const corr = calculatePearsonCorrelation(xVals, yVals);
    return {
      metric_x: metricX,
      metric_y: metricY,
      ...corr,
    };
  }

  /**
   * Summarizes comments for a video.
   */
  getVideoCommentsSummary(videoId: string, limit: number = 5): {
    video_id: string;
    total_comments: number;
    top_comments: { comment_id: string; author: string; text: string; likes: number }[];
  } {
    const totalRow = this.db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE video_id = ?').get(videoId) as any;
    const total = totalRow?.cnt || 0;

    const top = this.db
      .prepare(
        'SELECT comment_id, author_username, text, like_count FROM comments WHERE video_id = ? ORDER BY like_count DESC LIMIT ?'
      )
      .all(videoId, limit) as any[];

    return {
      video_id: videoId,
      total_comments: total,
      top_comments: top.map((c) => ({
        comment_id: c.comment_id,
        author: c.author_username || 'anonymous',
        text: c.text,
        likes: c.like_count || 0,
      })),
    };
  }

  /**
   * Deterministic Hashtag Analytics conforming to update2.md & fix1.md.
   * Guarantees that COUNT, SUM, AVG, MIN, MAX all share the EXACT same population and source of truth.
   */
  getHashtagAnalytics(
    hashtag: string,
    operation: AggregationType = 'SUM',
    metric: SupportedMetric = 'views',
    filters?: FilterCriteria
  ): HashtagAnalyticsResult {
    const cleanTag = hashtag.toLowerCase().replace(/^#/, '').trim();
    const displayTag = hashtag.startsWith('#') ? hashtag : `#${hashtag}`;
    const creator = filters?.creator ? normalizeCreatorHandle(filters.creator) : undefined;

    const stats = getHashtagPopulationAnalytics(cleanTag, { creator, sampleLimit: 10 });

    let sumVal = stats.total_views;
    let avgVal = stats.avg_views;
    let minVal = stats.min_views;
    let maxVal = stats.max_views;

    if (metric === 'likes') {
      sumVal = stats.total_likes;
      avgVal = stats.avg_likes;
    } else if (metric === 'shares') {
      sumVal = stats.total_shares;
      avgVal = stats.avg_shares;
    } else if (metric === 'comments') {
      sumVal = stats.total_comments;
      avgVal = stats.avg_comments;
    }

    return {
      operation,
      metric,
      population: {
        count: stats.video_count,
        scope: stats.scope,
        filters: {
          hashtag: cleanTag,
          normalized_tag: stats.normalized_tag,
          display_tag: stats.display_tag || displayTag,
          creator: stats.creator,
        },
      },
      aggregation: {
        count: stats.video_count,
        sum: sumVal,
        avg: avgVal,
        min: minVal,
        max: maxVal,
      },
      sample_videos: stats.sample_videos,
      entity_ids: stats.entity_ids,
      source: 'sqlite',
    };
  }

  /**
   * Evaluates deterministic metrics for videos matching ALL specified hashtags simultaneously (intersection).
   */
  getHashtagIntersection(
    hashtags: string[],
    operation: AggregationType = 'COUNT',
    metric: SupportedMetric = 'views',
    filters?: FilterCriteria
  ): HashtagAnalyticsResult {
    const creator = filters?.creator ? normalizeCreatorHandle(filters.creator) : undefined;
    const stats = getHashtagIntersectionAnalytics(hashtags, { creator, sampleLimit: 10 });

    let sumVal = stats.total_views;
    let avgVal = stats.avg_views;
    let minVal = stats.min_views;
    let maxVal = stats.max_views;

    if (metric === 'likes') {
      sumVal = stats.total_likes;
      avgVal = stats.avg_likes;
    } else if (metric === 'shares') {
      sumVal = stats.total_shares;
      avgVal = stats.avg_shares;
    } else if (metric === 'comments') {
      sumVal = stats.total_comments;
      avgVal = stats.avg_comments;
    }

    return {
      operation,
      metric,
      population: {
        count: stats.video_count,
        scope: stats.scope,
        filters: {
          hashtag: stats.normalized_tag,
          normalized_tag: stats.normalized_tag,
          display_tag: stats.display_tag,
          creator: stats.creator,
        },
      },
      aggregation: {
        count: stats.video_count,
        sum: sumVal,
        avg: avgVal,
        min: minVal,
        max: maxVal,
      },
      sample_videos: stats.sample_videos,
      entity_ids: stats.entity_ids,
      source: 'sqlite',
    };
  }

  /**
   * Deterministic side-by-side comparison between two hashtags across complete populations.
   */
  compareHashtags(
    hashtag1: string,
    hashtag2: string,
    metric: SupportedMetric = 'views',
    filters?: FilterCriteria
  ) {
    const s1 = this.getHashtagAnalytics(hashtag1, 'SUM', metric, filters);
    const s2 = this.getHashtagAnalytics(hashtag2, 'SUM', metric, filters);

    const sum1 = s1.aggregation.sum;
    const sum2 = s2.aggregation.sum;
    const count1 = s1.population.count;
    const count2 = s2.population.count;
    const avg1 = s1.aggregation.avg;
    const avg2 = s2.aggregation.avg;

    const diffViews = sum1 - sum2;
    const diffCount = count1 - count2;
    const diffAvg = avg1 - avg2;

    return {
      tag1: s1,
      tag2: s2,
      diff_views: diffViews,
      diff_count: diffCount,
      diff_avg: diffAvg,
      views_ratio: sum2 > 0 ? Number((sum1 / sum2).toFixed(2)) : null,
      leader: sum1 >= sum2 ? s1.population.filters.display_tag : s2.population.filters.display_tag,
    };
  }
}

export interface HashtagAnalyticsResult {
  operation: string;
  metric: string;
  population: {
    count: number;
    scope: 'DATASET' | 'CREATOR';
    filters: {
      hashtag: string;
      normalized_tag: string;
      display_tag: string;
      creator?: string;
    };
  };
  aggregation: {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    median?: number;
  };
  sample_videos: any[];
  entity_ids: string[];
  source: 'sqlite';
}

export const analyticsEngine = new AnalyticsEngine();

