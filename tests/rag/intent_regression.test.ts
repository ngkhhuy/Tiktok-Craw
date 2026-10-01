/**
 * Intent Understanding & Query Planning Regression Test Suite
 *
 * Validates the fix for:
 * 1. Multi-metric and mixed-aggregation queries (e.g. COUNT(video_id) + SUM(shares))
 * 2. Channel-vs-channel total comparisons without substituting medians or means
 * 3. Channel percentage of global views (RATIO / PERCENTAGE_OF_GLOBAL)
 * 4. Preventing unwanted correlation classification
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { queryPlanner } from '../../src/query/query-planner.js';
import { ragService } from '../../src/rag/rag-service.js';

describe('RAG Intent Understanding & Query Planning Regression Tests', () => {
  test('Case 1: "@beernary có bao nhiêu views và likes?" → AGGREGATION with multi-metric plan', () => {
    const plan = queryPlanner.plan('@beernary có bao nhiêu views và likes?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.deepEqual(plan.entity, { type: 'CHANNEL', id: '@beernary' });
    assert.deepEqual(plan.metrics, [
      { field: 'views', aggregation: 'SUM' },
      { field: 'likes', aggregation: 'SUM' },
    ]);
    assert.equal(plan.scope, 'CHANNEL');
    assert.equal(plan.group_by, null);
  });

  test('Case 1b: Exact user prompt: "Channel @beernary có bao nhiêu lượt xem và lượt thích?" → AGGREGATION', () => {
    const plan = queryPlanner.plan('Channel @beernary có bao nhiêu lượt xem và lượt thích?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.deepEqual(plan.entity, { type: 'CHANNEL', id: '@beernary' });
    assert.deepEqual(plan.metrics, [
      { field: 'views', aggregation: 'SUM' },
      { field: 'likes', aggregation: 'SUM' },
    ]);
    assert.equal(plan.scope, 'CHANNEL');
    assert.equal(plan.group_by, null);
  });

  test('Case 2: "@beernary có tổng bao nhiêu views?" → AGGREGATION', () => {
    const plan = queryPlanner.plan('@beernary có tổng bao nhiêu views?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.deepEqual(plan.entity, { type: 'CHANNEL', id: '@beernary' });
    assert.deepEqual(plan.metrics, [
      { field: 'views', aggregation: 'SUM' },
    ]);
    assert.equal(plan.scope, 'CHANNEL');
    assert.equal(plan.group_by, null);
  });

  test('Case 3: "Trung bình views và likes của @beernary?" → AGGREGATION', () => {
    const plan = queryPlanner.plan('Trung bình views và likes của @beernary?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.deepEqual(plan.entity, { type: 'CHANNEL', id: '@beernary' });
    assert.deepEqual(plan.metrics, [
      { field: 'views', aggregation: 'AVG' },
      { field: 'likes', aggregation: 'AVG' },
    ]);
    assert.equal(plan.scope, 'CHANNEL');
    assert.equal(plan.group_by, null);
  });

  test('Case 4: "Channel nào có nhiều views nhất?" → RANKING', () => {
    const plan = queryPlanner.plan('Channel nào có nhiều views nhất?');
    assert.equal(plan.intent, 'RANKING');
    assert.equal(plan.scope, 'DATASET');
    assert.equal(plan.group_by, 'channel');
  });

  test('Case 5: "@beernary có nhiều views hơn @channel_B không?" → COMPARISON', () => {
    const plan = queryPlanner.plan('@beernary có nhiều views hơn @channel_B không?');
    assert.equal(plan.intent, 'COMPARISON');
    assert.deepEqual(plan.entities.creators, ['beernary', 'channel_b']);
  });

  test('Case 6: "Views và likes của @beernary có tương quan không?" → CORRELATION', () => {
    const plan = queryPlanner.plan('Views và likes của @beernary có tương quan không?');
    assert.equal(plan.intent, 'CORRELATION');
  });

  test('Case 6b: "Mối quan hệ giữa views và likes là gì?" → CORRELATION', () => {
    const plan = queryPlanner.plan('Mối quan hệ giữa views và likes là gì?');
    assert.equal(plan.intent, 'CORRELATION');
  });

  test('Requirement 1: Total shares on @khoailangthang executes SUM(shares)', async () => {
    const plan = queryPlanner.plan('@khoailangthang có tổng bao nhiêu lượt share?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.deepEqual(plan.metrics, [{ field: 'shares', aggregation: 'SUM' }]);

    const result = await ragService.query('@khoailangthang có tổng bao nhiêu lượt share?');
    assert.equal(result.intent, 'AGGREGATION');
    assert.ok(
      result.answer.includes('1,386,734') || result.answer.includes('1.386.734'),
      'Expected answer to include exact total shares 1,386,734'
    );
  });

  test('Requirement 2: Mixed multi-metric "@khoailangthang có bao nhiêu video và tổng số lượt share là bao nhiêu?" executes COUNT(video_id) and SUM(shares)', async () => {
    const plan = queryPlanner.plan('@khoailangthang có bao nhiêu video và tổng số lượt share là bao nhiêu?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.deepEqual(plan.metrics, [
      { field: 'video_id', aggregation: 'COUNT' },
      { field: 'shares', aggregation: 'SUM' },
    ]);

    const result = await ragService.query(
      '@khoailangthang có bao nhiêu video và tổng số lượt share là bao nhiêu?'
    );
    assert.equal(result.intent, 'AGGREGATION');
    assert.ok(result.answer.includes('303'), 'Expected answer to include exact video count 303');
    assert.ok(
      result.answer.includes('1,386,734') || result.answer.includes('1.386.734'),
      'Expected answer to include exact total shares 1,386,734'
    );
  });

  test('Requirement 3: Channel-vs-channel total comparison executes SUM(views), SUM(likes), SUM(shares)', async () => {
    const plan = queryPlanner.plan(
      'So sánh tổng lượt xem, lượt thích và lượt share của @beernary với @khoailangthang'
    );
    assert.equal(plan.intent, 'COMPARISON');
    assert.deepEqual(plan.metrics, [
      { field: 'views', aggregation: 'SUM' },
      { field: 'likes', aggregation: 'SUM' },
      { field: 'shares', aggregation: 'SUM' },
    ]);

    const result = await ragService.query(
      'So sánh tổng lượt xem, lượt thích và lượt share của @beernary với @khoailangthang'
    );
    assert.equal(result.intent, 'COMPARISON');
    // Verify exact sums for both channels are present
    assert.ok(
      result.answer.includes('2,800,511') || result.answer.includes('2.800.511'),
      'Expected beernary views 2,800,511'
    );
    assert.ok(
      result.answer.includes('885,143,800') || result.answer.includes('885.143.800'),
      'Expected khoailangthang views 885,143,800'
    );
    assert.ok(
      result.answer.includes('1,386,734') || result.answer.includes('1.386.734'),
      'Expected khoailangthang shares 1,386,734'
    );
  });

  test('Requirement 4: Channel percentage of global views executes channel views / total dataset views * 100', async () => {
    const plan = queryPlanner.plan(
      '@khoailangthang chiếm bao nhiêu % tổng lượt xem của toàn bộ dataset?'
    );
    assert.equal(plan.intent, 'AGGREGATION');
    assert.equal(plan.metrics?.[0]?.field, 'views');
    assert.equal(plan.metrics?.[0]?.aggregation, 'RATIO');

    const result = await ragService.query(
      '@khoailangthang chiếm bao nhiêu % tổng lượt xem của toàn bộ dataset?'
    );
    assert.equal(result.intent, 'AGGREGATION');
    // Channel has 885,143,800 / 1,337,830,500 * 100 = 66.16%
    assert.ok(
      result.answer.includes('66.16%') ||
        result.answer.includes('66.16') ||
        result.answer.includes('66,16%') ||
        result.answer.includes('66,16'),
      'Expected answer to include exact calculated percentage 66.16%'
    );
    assert.ok(
      result.answer.includes('885,143,800') || result.answer.includes('885.143.800'),
      'Expected answer to include channel views 885,143,800'
    );
  });

  test('End-to-End Execution of Multi-Metric Channel Aggregation on @beernary', async () => {
    const result = await ragService.query('Channel @beernary có bao nhiêu lượt xem và lượt thích?');
    assert.equal(result.intent, 'AGGREGATION');
    assert.ok(
      result.answer.includes('2,800,511') ||
        result.answer.includes('2.800.511') ||
        result.answer.includes('2800511'),
      'Expected answer to include exact view count 2,800,511'
    );
    assert.ok(
      result.answer.includes('74,781') ||
        result.answer.includes('74.781') ||
        result.answer.includes('74781'),
      'Expected answer to include exact like count 74,781'
    );
  });

  // ==========================================
  // New Audit Requirements: Metric Semantics & Entity Normalization
  // ==========================================

  test('New Audit 1: "@beernary có share rate trung bình là bao nhiêu?" executes AVG(shares / views)', async () => {
    const plan = queryPlanner.plan('@beernary có share rate trung bình là bao nhiêu?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.equal(plan.metrics?.[0]?.field, 'share_rate');
    assert.equal(plan.metrics?.[0]?.aggregation, 'AVG');
    assert.ok(
      plan.explanation.includes('AVG(shares / views)'),
      `Expected explanation to specify AVG(shares / views), got: ${plan.explanation}`
    );

    const result = await ragService.query('@beernary có share rate trung bình là bao nhiêu?');
    assert.equal(result.intent, 'AGGREGATION');
    // Value is 0.0019 (0.19%), NOT 14.25 (AVG(shares))
    assert.ok(
      result.answer.includes('0.19%') || result.answer.includes('0.0019'),
      'Expected answer to include rate percentage 0.19% or 0.0019'
    );
    assert.ok(
      !result.answer.includes('14.25') && !result.answer.includes('14.2505'),
      'Must NOT return AVG(shares) 14.25 as share rate'
    );
  });

  test('New Audit 2: "@beernary có tổng bao nhiêu lượt share?" executes SUM(shares)', async () => {
    const plan = queryPlanner.plan('@beernary có tổng bao nhiêu lượt share?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.equal(plan.metrics?.[0]?.field, 'shares');
    assert.equal(plan.metrics?.[0]?.aggregation, 'SUM');

    const result = await ragService.query('@beernary có tổng bao nhiêu lượt share?');
    assert.equal(result.intent, 'AGGREGATION');
    assert.ok(
      result.answer.includes('6,826') || result.answer.includes('6.826') || result.answer.includes('6826'),
      'Expected answer to include exact total shares 6,826'
    );
  });

  test('New Audit 3: "@beernary có bao nhiêu lượt share trung bình mỗi video?" executes AVG(shares)', async () => {
    const plan = queryPlanner.plan('@beernary có bao nhiêu lượt share trung bình mỗi video?');
    assert.equal(plan.intent, 'AGGREGATION');
    assert.equal(plan.metrics?.[0]?.field, 'shares');
    assert.equal(plan.metrics?.[0]?.aggregation, 'AVG');

    const result = await ragService.query('@beernary có bao nhiêu lượt share trung bình mỗi video?');
    assert.equal(result.intent, 'AGGREGATION');
    assert.ok(
      result.answer.includes('14.25') || result.answer.includes('14.2505'),
      'Expected answer to include average shares per video 14.25'
    );
    assert.ok(
      !result.answer.includes('0.19%'),
      'Must NOT return share_rate 0.19% for avg shares query'
    );
  });

  test('New Audit 4: "So sánh tổng lượt xem, lượt thích và lượt share của @beernary với @khoailangthang." normalizes trailing punctuation', async () => {
    const plan = queryPlanner.plan(
      'So sánh tổng lượt xem, lượt thích và lượt share của @beernary với @khoailangthang.'
    );
    assert.equal(plan.intent, 'COMPARISON');
    assert.deepEqual(plan.entities.creators, ['beernary', 'khoailangthang']);
    assert.deepEqual(plan.metrics, [
      { field: 'views', aggregation: 'SUM' },
      { field: 'likes', aggregation: 'SUM' },
      { field: 'shares', aggregation: 'SUM' },
    ]);

    const result = await ragService.query(
      'So sánh tổng lượt xem, lượt thích và lượt share của @beernary với @khoailangthang.'
    );
    assert.equal(result.intent, 'COMPARISON');
    assert.ok(
      result.answer.includes('2,800,511') || result.answer.includes('2.800.511'),
      'Expected beernary views 2,800,511'
    );
    assert.ok(
      result.answer.includes('885,143,800') || result.answer.includes('885.143.800'),
      'Expected khoailangthang views 885,143,800'
    );
    assert.ok(
      !result.answer.includes('@khoailangthang.') && !result.answer.includes('N/A'),
      'Must normalize handle and not output N/A'
    );
  });

  test('New Audit 5: "So sánh @beernary với @khoailangthang." resolves both channels without N/A', async () => {
    const plan = queryPlanner.plan('So sánh @beernary với @khoailangthang.');
    assert.equal(plan.intent, 'COMPARISON');
    assert.deepEqual(plan.entities.creators, ['beernary', 'khoailangthang']);

    const result = await ragService.query('So sánh @beernary với @khoailangthang.');
    assert.equal(result.intent, 'COMPARISON');
    assert.ok(
      result.answer.includes('479 video') || result.answer.includes('479'),
      'Expected beernary video count 479'
    );
    assert.ok(
      result.answer.includes('303 video') || result.answer.includes('303'),
      'Expected khoailangthang video count 303'
    );
    assert.ok(
      !result.answer.includes('@khoailangthang.') && !result.answer.includes('total_videos = 0'),
      'Must find channel khoailangthang with positive video count'
    );
  });

  test('New Audit 6: "So sánh @beernary với @khoailangthang?" normalizes trailing question mark', async () => {
    const plan = queryPlanner.plan('So sánh @beernary với @khoailangthang?');
    assert.equal(plan.intent, 'COMPARISON');
    assert.deepEqual(plan.entities.creators, ['beernary', 'khoailangthang']);

    const result = await ragService.query('So sánh @beernary với @khoailangthang?');
    assert.equal(result.intent, 'COMPARISON');
    assert.ok(
      result.answer.includes('479') && result.answer.includes('303'),
      'Expected both channels to have valid video counts'
    );
  });
});
