/**
 * Comprehensive Evaluation & Test Suite for TikTok Analytics RAG System
 * 
 * update2.md Requirements:
 * - Deterministic calculations (zero hallucination)
 * - Safe zero-division handling
 * - Population baseline & percentile benchmarking
 * - 6 query categories coverage:
 *   1. Metric questions
 *   2. Comparisons
 *   3. Aggregations
 *   4. Ranking
 *   5. Semantic / comment analysis
 *   6. Correlation & Hybrid analytical questions
 * - Multi-turn conversation context retention
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDifference,
  calculateMedian,
  calculatePearsonCorrelation,
  calculatePercentile,
  calculatePercentileRank,
  calculateRates,
  calculateRatio,
} from '../../src/analytics/metric-definitions.js';
import { analyticsEngine } from '../../src/analytics/analytics-engine.js';
import { getPopulationBaseline } from '../../src/analytics/baseline.js';
import { queryPlanner } from '../../src/query/query-planner.js';
import { entityResolver } from '../../src/query/entity-resolver.js';
import { SQLiteVectorStore, vectorStore } from '../../src/vector/vector-store.js';
import { semanticRetriever } from '../../src/retrieval/semantic-retriever.js';
import { ragService } from '../../src/rag/rag-service.js';
import { conversationManager } from '../../src/conversation/conversation-manager.js';

describe('1. Deterministic Mathematical Calculations & Zero-Division Safety', () => {
  test('calculateRates should handle zero views without dividing by zero', () => {
    const rates = calculateRates({ views: 0, likes: 50, comments: 10, shares: 5 });
    assert.equal(rates.like_rate, null);
    assert.equal(rates.comment_rate, null);
    assert.equal(rates.share_rate, null);
    assert.equal(rates.engagement_rate, null);
  });

  test('calculateRates should compute exact rates with positive views', () => {
    const rates = calculateRates({ views: 1000, likes: 100, comments: 20, shares: 10 });
    assert.equal(rates.like_rate, 0.1);
    assert.equal(rates.comment_rate, 0.02);
    assert.equal(rates.share_rate, 0.01);
    assert.equal(rates.engagement_rate, 0.13); // (100 + 20 + 10) / 1000
  });

  test('calculateRatio should safely guard against division by zero', () => {
    assert.equal(calculateRatio(100, 0), null);
    assert.equal(calculateRatio(100, -5), null);
    assert.equal(calculateRatio(100, 20), 5);
  });

  test('calculateMedian should correctly compute odd and even medians', () => {
    assert.equal(calculateMedian([5, 1, 3]), 3);
    assert.equal(calculateMedian([1, 2, 3, 4]), 2.5);
    assert.equal(calculateMedian([]), null);
  });

  test('calculatePercentile should compute accurate p25, p50, p90', () => {
    const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.equal(calculatePercentile(vals, 50), 55);
    assert.equal(calculatePercentile(vals, 0), 10);
    assert.equal(calculatePercentile(vals, 100), 100);
  });

  test('calculatePercentileRank should return percentile position 0-100', () => {
    const vals = [10, 20, 30, 40, 50];
    assert.equal(calculatePercentileRank(vals, 50), 90);
    assert.equal(calculatePercentileRank(vals, 10), 10);
  });

  test('calculateDifference should compute exact diff and percent change', () => {
    const res = calculateDifference(150, 100);
    assert.equal(res.diff, 50);
    assert.equal(res.percent_change, 50); // +50%

    const zeroBaseline = calculateDifference(50, 0);
    assert.equal(zeroBaseline.diff, 50);
    assert.equal(zeroBaseline.percent_change, null); // Cannot divide by 0
  });

  test('calculatePearsonCorrelation should include warning that correlation is not causation', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10]; // Perfect positive correlation r = 1.0
    const res = calculatePearsonCorrelation(x, y);
    assert.equal(res.r, 1);
    assert.equal(res.n, 5);
    assert.ok(res.warning.includes('Correlation is NOT causation'));
  });
});

describe('2. Population Baselines & Benchmarks', () => {
  test('getPopulationBaseline for all_videos should return valid metrics', () => {
    const baseline = getPopulationBaseline('all_videos');
    assert.ok(baseline.total_videos > 0);
    assert.ok(baseline.metrics.views.count > 0);
    assert.ok(baseline.metrics.views.median > 0);
    assert.ok(baseline.metrics.engagement_rate.count > 0);
  });

  test('getPopulationBaseline for specific creator should filter correctly', () => {
    const baseline = getPopulationBaseline('creator:beernary');
    assert.ok(baseline.total_videos > 0);
    assert.ok(baseline.population === 'creator:beernary');
  });
});

describe('3. Analytics Engine Deterministic Operations', () => {
  test('getAggregate COUNT, SUM, AVG, MEDIAN on views', () => {
    const count = analyticsEngine.getAggregate('views', 'COUNT');
    assert.ok(count.value !== null && count.value > 0);

    const sum = analyticsEngine.getAggregate('views', 'SUM');
    assert.ok(sum.value !== null && sum.value > 0);

    const avg = analyticsEngine.getAggregate('views', 'AVG');
    assert.ok(avg.value !== null && avg.value > 0);

    const median = analyticsEngine.getAggregate('views', 'MEDIAN');
    assert.ok(median.value !== null && median.value > 0);
  });

  test('getTopVideos returns descending order of views', () => {
    const top = analyticsEngine.getTopVideos('views', 5);
    assert.equal(top.length, 5);
    for (let i = 0; i < top.length - 1; i++) {
      assert.ok(top[i].views >= top[i + 1].views);
    }
  });

  test('compareVideos between two top videos generates side-by-side comparison', () => {
    const top2 = analyticsEngine.getTopVideos('views', 2);
    assert.equal(top2.length, 2);

    const comp = analyticsEngine.compareVideos(top2[0].video_id, top2[1].video_id);
    assert.ok(comp !== null);
    assert.ok(comp.comparison.views);
    assert.ok(comp.comparison.likes);
    assert.ok(comp.comparison.engagement_rate);
    assert.equal(comp.comparison.views.higher, 'video_a');
  });

  test('getMetricCorrelation between duration and views computes Pearson r', () => {
    const corr = analyticsEngine.getMetricCorrelation('duration', 'views');
    assert.equal(corr.metric_x, 'duration');
    assert.equal(corr.metric_y, 'views');
    assert.ok(corr.n > 0);
    assert.ok(typeof corr.r === 'number');
    assert.ok(corr.warning.includes('Correlation is NOT causation'));
  });
});

describe('4. Vector Store & Semantic Retrieval', () => {
  test('cosineSimilarity should return 1 for identical vectors', () => {
    const v1 = new Float32Array([1, 0, 0]);
    const v2 = new Float32Array([1, 0, 0]);
    assert.equal(SQLiteVectorStore.cosineSimilarity(v1, v2), 1);
  });

  test('cosineSimilarity should return 0 for orthogonal vectors', () => {
    const v1 = new Float32Array([1, 0]);
    const v2 = new Float32Array([0, 1]);
    assert.equal(SQLiteVectorStore.cosineSimilarity(v1, v2), 0);
  });

  test('semanticRetriever retrieves relevant chunks with MMR diversity', async () => {
    const chunks = await semanticRetriever.retrieve('video công nghệ server', { limit: 3 });
    assert.ok(chunks.length > 0);
    assert.ok(chunks[0].text);
    assert.ok(typeof chunks[0].score === 'number');
  });
});

describe('5. Query Understanding & Planning', () => {
  test('resolves METRIC_LOOKUP for single video URL', () => {
    const plan = queryPlanner.plan('Video https://www.tiktok.com/@beernary/video/7652377713977740564 có bao nhiêu view?');
    assert.equal(plan.intent, 'METRIC_LOOKUP');
    assert.deepEqual(plan.entities.videoIds, ['7652377713977740564']);
    assert.ok(plan.entities.metrics.includes('views'));
  });

  test('resolves COMPARISON for 2 video IDs', () => {
    const plan = queryPlanner.plan('So sánh video 7652377713977740564 và 7677074241539280148');
    assert.equal(plan.intent, 'COMPARISON');
    assert.equal(plan.entities.videoIds.length, 2);
  });

  test('resolves RANKING for top questions', () => {
    const plan = queryPlanner.plan('Top 3 video nhiều like nhất của @beernary');
    assert.equal(plan.intent, 'RANKING');
    assert.equal(plan.entities.creator, 'beernary');
    assert.equal(plan.entities.limit, 3);
    assert.equal(plan.entities.order, 'DESC');
  });

  test('resolves AGGREGATION for total views question', () => {
    const plan = queryPlanner.plan('Tổng số view của các video trong hệ thống');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.equal(plan.entities.aggregation, 'SUM');
  });

  test('resolves CORRELATION for duration vs view question', () => {
    const plan = queryPlanner.plan('Video dài hơn có nhiều view hơn không?');
    assert.equal(plan.intent, 'CORRELATION');
  });
});

describe('6. End-to-End RAG Pipeline & Multi-Turn Dialogue', () => {
  test('executes end-to-end ranking query and returns structured response', async () => {
    const result = await ragService.query('Top 3 video nhiều view nhất');
    assert.equal(result.intent, 'RANKING');
    assert.ok(result.answer.includes('Top 3'));
    assert.ok(result.latencyMs >= 0);
    assert.ok(result.sources.videosAnalyzed > 0);
  });

  test('preserves context across multi-turn follow-up questions', async () => {
    // Turn 1: Lookup video
    const turn1 = await ragService.query('Thông tin video 7677074241539280148');
    assert.equal(turn1.intent, 'METRIC_LOOKUP');
    assert.ok(turn1.answer.includes('7677074241539280148'));

    // Turn 2: Follow up referring to "video đó"
    const turn2 = await ragService.query('Video đó có bao nhiêu view và like?', turn1.sessionId);
    assert.equal(turn2.intent, 'METRIC_LOOKUP');
    assert.ok(
      turn2.answer.includes('1,600,000') ||
        turn2.answer.includes('1.600.000') ||
        turn2.answer.includes('1.6 triệu') ||
        turn2.answer.includes('1,6 triệu') ||
        turn2.answer.includes('1.6M') ||
        turn2.answer.includes('1,6M')
    );
  });

  test('correlation query returns non-causation warning', async () => {
    const result = await ragService.query('Thời lượng video có ảnh hưởng đến số view không?');
    assert.equal(result.intent, 'CORRELATION');
    assert.ok(
      result.answer.includes('Correlation is NOT causation') ||
        result.answer.includes('tương quan không đồng nghĩa với nhân quả') ||
        result.answer.includes('LƯU Ý QUAN TRỌNG')
    );
  });
});
