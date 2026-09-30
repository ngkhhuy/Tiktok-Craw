/**
 * Deterministic Metric Definitions & Calculation Rules
 * 
 * In accordance with update2.md:
 * - Deterministic, verified mathematical calculations.
 * - Guard against division by zero (return null, never NaN or Infinity).
 * - Explicit types for supported metrics, aggregations, and evidence payloads.
 */

export type SupportedMetric =
  | 'views'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'saves'
  | 'duration'
  | 'like_rate'
  | 'comment_rate'
  | 'share_rate'
  | 'save_rate'
  | 'engagement_rate';

export type AggregationType =
  | 'COUNT'
  | 'SUM'
  | 'AVG'
  | 'MEDIAN'
  | 'MIN'
  | 'MAX'
  | 'PERCENTILE'
  | 'RANK'
  | 'RATIO';

export type ComparisonPopulation =
  | 'all_videos'
  | 'same_creator'
  | 'same_hashtag'
  | 'same_time_period';

export interface FilterCriteria {
  creator?: string;
  startDate?: string;
  endDate?: string;
  minViews?: number;
  maxViews?: number;
  minDuration?: number;
  maxDuration?: number;
  hashtag?: string;
  keyword?: string;
}

export interface MetricRates {
  like_rate: number | null;
  comment_rate: number | null;
  share_rate: number | null;
  save_rate: number | null;
  engagement_rate: number | null;
}

/**
 * Calculates engagement and interaction rates strictly handling zero-division.
 */
export function calculateRates(engagement: {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves?: number;
}): MetricRates {
  const views = engagement.views || 0;
  if (views <= 0) {
    return {
      like_rate: null,
      comment_rate: null,
      share_rate: null,
      save_rate: null,
      engagement_rate: null,
    };
  }

  const likes = engagement.likes || 0;
  const comments = engagement.comments || 0;
  const shares = engagement.shares || 0;
  const saves = engagement.saves || 0;

  return {
    like_rate: Number((likes / views).toFixed(6)),
    comment_rate: Number((comments / views).toFixed(6)),
    share_rate: Number((shares / views).toFixed(6)),
    save_rate: Number((saves / views).toFixed(6)),
    engagement_rate: Number(((likes + comments + shares) / views).toFixed(6)),
  };
}

/**
 * Safely compute a ratio between two numbers. Returns null if denominator is <= 0.
 */
export function calculateRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0 || !isFinite(denominator) || isNaN(denominator) || isNaN(numerator)) {
    return null;
  }
  return Number((numerator / denominator).toFixed(6));
}

/**
 * Computes median from an array of numbers.
 */
export function calculateMedian(values: number[]): number | null {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(4));
  }
  return Number(sorted[mid].toFixed(4));
}

/**
 * Computes given percentile (0 to 100) from an array of numbers.
 */
export function calculatePercentile(values: number[], percentile: number): number | null {
  if (!values || values.length === 0) return null;
  if (percentile <= 0) return Math.min(...values);
  if (percentile >= 100) return Math.max(...values);

  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) return sorted[lower];
  const interpolated = sorted[lower] * (1 - weight) + sorted[upper] * weight;
  return Number(interpolated.toFixed(4));
}

/**
 * Computes the percentile rank (0 to 100) of a value within an array of values.
 */
export function calculatePercentileRank(values: number[], value: number): number {
  if (!values || values.length === 0) return 0;
  let countBelow = 0;
  let countEqual = 0;
  for (const v of values) {
    if (v < value) countBelow++;
    else if (v === value) countEqual++;
  }
  const rank = ((countBelow + 0.5 * countEqual) / values.length) * 100;
  return Number(rank.toFixed(1));
}

/**
 * Computes absolute and percentage difference between baseline A and subject B.
 */
export function calculateDifference(
  subject: number | null,
  baseline: number | null
): { diff: number | null; percent_change: number | null } {
  if (subject === null || baseline === null) {
    return { diff: null, percent_change: null };
  }
  const diff = Number((subject - baseline).toFixed(4));
  if (baseline === 0) {
    return { diff, percent_change: null };
  }
  const percentChange = Number((((subject - baseline) / Math.abs(baseline)) * 100).toFixed(2));
  return { diff, percent_change: percentChange };
}

/**
 * Computes Pearson correlation coefficient between two equal-length numeric arrays.
 */
export function calculatePearsonCorrelation(
  x: number[],
  y: number[]
): { r: number | null; n: number; interpretation: string; warning: string } {
  const n = Math.min(x.length, y.length);
  if (n < 3) {
    return {
      r: null,
      n,
      interpretation: 'Insufficient data points (n < 3)',
      warning: 'Correlation is NOT causation.',
    };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    numerator += diffX * diffY;
    denomX += diffX * diffX;
    denomY += diffY * diffY;
  }

  const denominator = Math.sqrt(denomX * denomY);
  if (denominator === 0) {
    return {
      r: 0,
      n,
      interpretation: 'Zero variance in one or both metrics',
      warning: 'Correlation is NOT causation.',
    };
  }

  const r = Number((numerator / denominator).toFixed(4));
  let interpretation = 'No correlation';
  const absR = Math.abs(r);
  if (absR >= 0.7) interpretation = r > 0 ? 'Strong positive correlation' : 'Strong negative correlation';
  else if (absR >= 0.4) interpretation = r > 0 ? 'Moderate positive correlation' : 'Moderate negative correlation';
  else if (absR >= 0.2) interpretation = r > 0 ? 'Weak positive correlation' : 'Weak negative correlation';

  return {
    r,
    n,
    interpretation,
    warning: 'Correlation is NOT causation. A statistical correlation does not establish a causal relationship.',
  };
}
