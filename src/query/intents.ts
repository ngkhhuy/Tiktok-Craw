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
  | 'DATASET_OVERVIEW';

export interface ResolvedEntities {
  videoIds: string[];
  creator?: string;
  metrics: SupportedMetric[];
  aggregation?: AggregationType;
  filters: FilterCriteria;
  isRanking?: boolean;
  limit: number;
  order: 'DESC' | 'ASC';
  searchTerm?: string;
  percentileTarget?: number;
}

export interface QueryPlan {
  intent: QueryIntent;
  entities: ResolvedEntities;
  execution_steps: string[];
  explanation: string;
}
