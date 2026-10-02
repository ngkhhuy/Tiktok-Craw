/**
 * Query Intents for TikTok Analytics RAG System
 * 
 * update2.md Requirements:
 * 1. Single metric questions
 * 2. Comparisons
 * 3. Aggregations
 * 4. Ranking
 * 5. Semantic / comment analysis
 * 6. Correlation / analytical questions
 * 7. Creator performance
 * 8. Hybrid (metric + semantic)
 * 9. Dataset overview
 */

import { AggregationType, FilterCriteria, SupportedMetric } from '../analytics/metric-definitions.js';

export type QueryIntent =
  | 'METRIC_LOOKUP'
  | 'COMPARISON'
  | 'AGGREGATION'
  | 'RANKING'
  | 'SEMANTIC_SEARCH'
  | 'CORRELATION'
  | 'CREATOR_ANALYSIS'
  | 'HYBRID'
  | 'DATASET_OVERVIEW'
  | 'HASHTAG_ANALYSIS';

export interface ResolvedEntities {
  videoIds: string[];
  creator?: string;
  creators?: string[];
  metrics: SupportedMetric[];
  aggregation?: AggregationType;
  metricPlans?: MetricAggregationPlan[];
  filters: FilterCriteria;
  isRanking?: boolean;
  limit: number;
  order: 'DESC' | 'ASC';
  searchTerm?: string;
  percentileTarget?: number;
  hashtag?: string;         // specific hashtag queried (e.g. "vietnam")
  displayHashtag?: string;  // original display hashtag (e.g. "#AnDo")
  hashtags?: string[];      // list of hashtags if multiple were queried
  displayHashtags?: string[]; // list of original display hashtags
  isHashtagQuery?: boolean; // true when query is primarily about hashtags
  isHashtagIntersection?: boolean; // true when querying intersection of multiple tags
  isHashtagComparison?: boolean;   // true when querying comparison between tags
}

export interface MetricAggregationPlan {
  field: SupportedMetric;
  aggregation: AggregationType;
}

export interface QueryPlanEntity {
  type: 'CHANNEL' | 'VIDEO' | 'DATASET';
  id: string;
}

export interface QueryPlan {
  intent: QueryIntent;
  entities: ResolvedEntities;
  execution_steps: string[];
  explanation: string;
  entity?: QueryPlanEntity | null;
  metrics?: MetricAggregationPlan[];
  scope?: 'CHANNEL' | 'VIDEO' | 'DATASET';
  group_by?: string | null;
}
