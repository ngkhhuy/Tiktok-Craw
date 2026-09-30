/**
 * Population Benchmark & Baseline Engine
 * 
 * update2.md Requirement:
 * - "Never say 'video views are high' without specifying what it is compared to:
 *    the entire dataset, the same creator, or the same topic."
 * - Calculate median, percentiles (p25, p50, p75, p90, p95), mean, min, max.
 */

import { getDb } from '../storage/database.js';
import {
  calculateMedian,
  calculatePercentile,
  calculateRates,
  SupportedMetric,
} from './metric-definitions.js';

export interface MetricSummary {
  metric: SupportedMetric;
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface BaselineBenchmark {
  population: string;
  total_videos: number;
  metrics: Record<SupportedMetric, MetricSummary>;
  generated_at: string;
}

// In-memory cache for baselines (invalidated after 60 seconds)
const baselineCache = new Map<string, { data: BaselineBenchmark; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export function getPopulationBaseline(
  population: 'all_videos' | `creator:${string}` | `duration:${'short' | 'medium' | 'long'}`
): BaselineBenchmark {
  const cached = baselineCache.get(population);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const db = getDb();
  let sql = `
    SELECT
      video_id, username, views, likes, comments_count, shares, saves, duration, published_at
    FROM videos
    WHERE status = 'completed'
  `;
  const params: any[] = [];

  if (population.startsWith('creator:')) {
    const creator = population.replace('creator:', '');
    sql += ` AND username = ?`;
    params.push(creator);
  } else if (population === 'duration:short') {
    sql += ` AND duration > 0 AND duration <= 15`;
  } else if (population === 'duration:medium') {
    sql += ` AND duration > 15 AND duration <= 60`;
  } else if (population === 'duration:long') {
    sql += ` AND duration > 60`;
  }

  const rows = db.prepare(sql).all(...params) as any[];

  const metricValues: Record<SupportedMetric, number[]> = {
    views: [],
    likes: [],
    comments: [],
    shares: [],
    saves: [],
    duration: [],
    like_rate: [],
    comment_rate: [],
    share_rate: [],
    save_rate: [],
    engagement_rate: [],
  };

  for (const row of rows) {
    const views = Number(row.views) || 0;
    const likes = Number(row.likes) || 0;
    const comments = Number(row.comments_count) || 0;
    const shares = Number(row.shares) || 0;
    const saves = Number(row.saves) || 0;
    const duration = Number(row.duration) || 0;

    metricValues.views.push(views);
    metricValues.likes.push(likes);
    metricValues.comments.push(comments);
    metricValues.shares.push(shares);
    metricValues.saves.push(saves);
    if (duration > 0) metricValues.duration.push(duration);

    if (views > 0) {
      const rates = calculateRates({ views, likes, comments, shares, saves });
      if (rates.like_rate !== null) metricValues.like_rate.push(rates.like_rate);
      if (rates.comment_rate !== null) metricValues.comment_rate.push(rates.comment_rate);
      if (rates.share_rate !== null) metricValues.share_rate.push(rates.share_rate);
      if (rates.save_rate !== null) metricValues.save_rate.push(rates.save_rate);
      if (rates.engagement_rate !== null) metricValues.engagement_rate.push(rates.engagement_rate);
    }
  }

  const metricsObj = {} as Record<SupportedMetric, MetricSummary>;
  const allMetricKeys = Object.keys(metricValues) as SupportedMetric[];

  for (const key of allMetricKeys) {
    const arr = metricValues[key];
    if (arr.length === 0) {
      metricsObj[key] = {
        metric: key,
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p25: 0,
        p75: 0,
        p90: 0,
        p95: 0,
      };
      continue;
    }

    const count = arr.length;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const sum = arr.reduce((acc, v) => acc + v, 0);
    const mean = Number((sum / count).toFixed(4));
    const median = calculateMedian(arr) ?? 0;
    const p25 = calculatePercentile(arr, 25) ?? 0;
    const p75 = calculatePercentile(arr, 75) ?? 0;
    const p90 = calculatePercentile(arr, 90) ?? 0;
    const p95 = calculatePercentile(arr, 95) ?? 0;

    metricsObj[key] = {
      metric: key,
      count,
      min,
      max,
      mean,
      median,
      p25,
      p75,
      p90,
      p95,
    };
  }

  const result: BaselineBenchmark = {
    population,
    total_videos: rows.length,
    metrics: metricsObj,
    generated_at: new Date().toISOString(),
  };

  baselineCache.set(population, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export function clearBaselineCache(): void {
  baselineCache.clear();
}
