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
import { analyticsEngine } from '../../src/analytics/analytics-engine.js';

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
    const share = analyticsEngine.getChannelShareOfDataset('khoailangthang', 'views', 'SUM');
    const expectedPct = share.percentage.toString();
    assert.ok(
      result.answer.includes(`${share.percentage}%`) ||
        result.answer.includes(expectedPct) ||
        result.answer.includes(expectedPct.replace('.', ',')) ||
        result.answer.includes('66.16%') ||
        result.answer.includes('65.86%'),
      `Expected answer to include exact calculated percentage ${share.percentage}%`
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
      result.answer.includes('14.25') || result.answer.includes('14,25') || result.answer.includes('14.2505'),
      'Expected answer to include average shares per video 14.25 or 14,25'
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
      !result.answer.includes('total_videos = 0'),
      'Must find channel khoailangthang with positive video count'
    );
    assert.ok(
      !plan.entities.creators.includes('khoailangthang.'),
      'Planner must strip trailing punctuation from username'
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

  // ---------------------------------------------------------------------------
  // Video Ranking with Creator Filter — must never route to channel ranking
  // ---------------------------------------------------------------------------

  test('Video Ranking 1: Top 3 video xem nhất @khoailangthang → VIDEO scope, limit=3', () => {
    const plan = queryPlanner.plan('Top 3 video nhiều lượt xem nhất của kênh @khoailangthang');
    assert.equal(plan.intent, 'RANKING');
    assert.equal(plan.group_by, null, 'group_by should NOT be "channel"');
    assert.equal(plan.entities.limit, 3);
    assert.equal(plan.entities.creator, 'khoailangthang');
    assert.equal(plan.entities.filters?.creator, 'khoailangthang');
    assert.ok(
      plan.execution_steps.some((s) => s.includes('getTopVideos')),
      'Should call getTopVideos not getTopCreators'
    );
    assert.ok(
      !plan.execution_steps.some((s) => s.includes('getTopCreators')),
      'Should NOT call getTopCreators'
    );
  });

  test('Video Ranking 2: Video nào của @beernary xem nhất? → VIDEO scope, limit=1', () => {
    const plan = queryPlanner.plan('Video nào của @beernary có nhiều lượt xem nhất?');
    assert.equal(plan.intent, 'RANKING');
    assert.equal(plan.group_by, null, 'group_by should NOT be "channel"');
    assert.equal(plan.entities.limit, 1);
    assert.equal(plan.entities.creator, 'beernary');
    assert.ok(
      plan.execution_steps.some((s) => s.includes('getTopVideos')),
      'Should call getTopVideos'
    );
    assert.ok(
      !plan.execution_steps.some((s) => s.includes('getTopCreators')),
      'Should NOT call getTopCreators'
    );
  });

  test('Video Ranking 3: Top 5 video share nhất @beernary → metric=shares', () => {
    const plan = queryPlanner.plan('Top 5 video có nhiều lượt share nhất của @beernary');
    assert.equal(plan.intent, 'RANKING');
    assert.equal(plan.group_by, null);
    assert.equal(plan.entities.limit, 5);
    assert.equal(plan.entities.creator, 'beernary');
    assert.ok(plan.entities.metrics.includes('shares'), 'Metric should include shares');
    assert.ok(
      plan.execution_steps.some((s) => s.includes('getTopVideos')),
      'Should call getTopVideos'
    );
  });

  test('Video Ranking 4: Top 3 video thích nhất @khoailangthang → metric=likes', () => {
    const plan = queryPlanner.plan('Top 3 video nhiều lượt thích nhất của @khoailangthang');
    assert.equal(plan.intent, 'RANKING');
    assert.equal(plan.group_by, null);
    assert.equal(plan.entities.limit, 3);
    assert.equal(plan.entities.creator, 'khoailangthang');
    assert.ok(plan.entities.metrics.includes('likes'), 'Metric should include likes');
    assert.ok(
      plan.execution_steps.some((s) => s.includes('getTopVideos')),
      'Should call getTopVideos'
    );
  });

  test('Video Ranking 5: Trailing punctuation does not break creator resolution', () => {
    const plan = queryPlanner.plan('Top 3 video nhiều lượt xem nhất của @khoailangthang.');
    assert.equal(plan.intent, 'RANKING');
    assert.equal(plan.entities.creator, 'khoailangthang', 'Trailing dot should be stripped');
    assert.equal(plan.entities.limit, 3);
    assert.ok(
      plan.execution_steps.some((s) => s.includes('getTopVideos')),
      'Should call getTopVideos'
    );
  });

  test('Channel Ranking (no creator filter) → group_by=channel, calls getTopCreators', () => {
    const plan = queryPlanner.plan('Channel nào có nhiều views nhất?');
    assert.equal(plan.intent, 'RANKING');
    assert.equal(plan.group_by, 'channel', 'Channel ranking should have group_by=channel');
    assert.ok(
      plan.execution_steps.some((s) => s.includes('getTopCreators')),
      'Channel ranking should call getTopCreators'
    );
    assert.ok(
      !plan.execution_steps.some((s) => s.includes('getTopVideos')),
      'Channel ranking should NOT call getTopVideos'
    );
  });

  test('Hashtag Query 1: "Top 5 hashtag phổ biến nhất" → HASHTAG_ANALYSIS', () => {
    const plan = queryPlanner.plan('Top 5 hashtag phổ biến nhất');
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.limit, 5);
    assert.equal(plan.entities.creator, undefined);
  });

  test('Hashtag Query 2: "Hashtag nào được @khoailangthang dùng nhiều nhất?" → HASHTAG_ANALYSIS with creator', () => {
    const plan = queryPlanner.plan('Hashtag nào được @khoailangthang dùng nhiều nhất?');
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.creator, 'khoailangthang');
  });

  test('Hashtag Query 3: "Video nào dùng hashtag #travel?" → HASHTAG_ANALYSIS with specific tag', () => {
    const plan = queryPlanner.plan('Video nào dùng hashtag #travel?');
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.hashtag, 'travel');
  });

  test('Hashtag Query 4: End-to-end execution of hashtag analysis', async () => {
    const result = await ragService.query('Top 3 hashtag có nhiều lượt xem nhất');
    assert.equal(result.intent, 'HASHTAG_ANALYSIS');
    assert.ok(result.answer.length > 50, 'Answer should not be empty');
    assert.ok(result.answer.includes('#') || result.answer.includes('hashtag'), 'Answer should mention hashtags');
  });

  test('Hashtag Scope Guard 1: Video query plan strictly resolves to VIDEO scope', () => {
    const plan = queryPlanner.plan('Video 7547434275306523905 có những hashtag nào phổ biến nhất?');
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.scope, 'VIDEO');
    assert.deepEqual(plan.entities.videoIds, ['7547434275306523905']);
    assert.ok(
      plan.execution_steps.some((s) => s.includes("getVideoHashtags('7547434275306523905')")),
      'Should specifically execute getVideoHashtags for the video'
    );
  });

  test('Hashtag Scope Guard 2: Video query end-to-end returns ONLY video evidence (no global leak)', async () => {
    const result = await ragService.query('Video 7547434275306523905 có những hashtag nào phổ biến nhất?');
    assert.equal(result.intent, 'HASHTAG_ANALYSIS');
    const h = result.evidence?.metrics?.hashtag;
    assert.equal(h?.scope, 'VIDEO');
    assert.equal(h?.video_id, '7547434275306523905');
    assert.equal(h?.status, 'SUCCESS');
    assert.ok(h?.hashtags.some((t: any) => t.hashtag.toLowerCase().includes('khoailangthang')));
    assert.ok(h?.hashtags.some((t: any) => t.hashtag.toLowerCase().includes('ando')));
    // Must NOT contain global dataset top hashtags like travel or learnontiktok
    assert.ok(!result.answer.includes('#travel'), 'Must not leak #travel from global dataset');
  });

  test('Hashtag Scope Guard 3: Missing video-level hashtag data returns appropriate notice', async () => {
    const result = await ragService.query('Video 9999999999999999999 có những hashtag nào?');
    assert.equal(result.intent, 'HASHTAG_ANALYSIS');
    const h = result.evidence?.metrics?.hashtag;
    assert.equal(h?.scope, 'VIDEO');
    assert.equal(h?.video_id, '9999999999999999999');
    assert.ok(
      result.answer.includes('Không có đủ dữ liệu hashtag cho video 9999999999999999999') ||
      result.answer.includes('không tồn tại trong tập dữ liệu'),
      'Must state that there is not enough data or video not found'
    );
  });

  // ─── fix1.md REGRESSION TESTS: HASHTAG POPULATION AGGREGATIONS & SCOPES ───

  test('fix1.md Test A: COUNT query on #AnDo returns exact population count', async () => {
    const query = 'Có bao nhiêu video trong toàn bộ dataset sử dụng hashtag #AnDo?';
    const plan = queryPlanner.plan(query);
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.hashtag, 'ando');
    assert.equal(plan.entities.displayHashtag, '#AnDo');
    assert.equal(plan.entities.aggregation, 'COUNT');

    const result = await ragService.query(query);
    const h = result.evidence?.metrics?.hashtag;
    assert.equal(h?.scope, 'SPECIFIC_HASHTAG');
    assert.equal(h?.video_count, 73, 'Full population count of #ando must be 73');
    assert.equal(h?.population?.count, 73);
    assert.ok(result.answer.includes('73'), 'Answer must mention exact count 73');
  });

  test('fix1.md Test B: SUM query on #AnDo returns exact total views across entire population', async () => {
    const query = 'Tổng lượt xem của tất cả video sử dụng hashtag #AnDo là bao nhiêu?';
    const plan = queryPlanner.plan(query);
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.hashtag, 'ando');
    assert.equal(plan.entities.aggregation, 'SUM');

    const result = await ragService.query(query);
    const h = result.evidence?.metrics?.hashtag;
    assert.equal(h?.scope, 'SPECIFIC_HASHTAG');
    assert.equal(h?.aggregation?.sum, 46375171, 'Total views of #ando must be 46,375,171');
    assert.equal(h?.total_views, 46375171);
    assert.ok(
      result.answer.includes('46.375.171') || result.answer.includes('46,375,171'),
      'Answer must quote authoritative pre-computed SUM 46,375,171'
    );
  });

  test('fix1.md Test C: AVG query on #AnDo returns exact average views and consistent count & sum', async () => {
    const query = 'Lượt xem trung bình của tất cả video sử dụng hashtag #AnDo là bao nhiêu?';
    const plan = queryPlanner.plan(query);
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.hashtag, 'ando');

    const result = await ragService.query(query);
    const h = result.evidence?.metrics?.hashtag;
    assert.equal(h?.scope, 'SPECIFIC_HASHTAG');
    assert.equal(h?.population?.count, 73);
    assert.equal(h?.aggregation?.sum, 46375171);
    assert.equal(h?.aggregation?.avg, 635276.32, 'AVG views must equal 635,276.32');
    assert.ok(
      result.answer.includes('635.276') || result.answer.includes('635,276'),
      'Answer must quote authoritative pre-computed AVG 635,276.32'
    );
  });

  test('fix1.md Test D: Mathematical consistency between COUNT, SUM, and AVG', async () => {
    const query = 'Lượt xem trung bình của tất cả video sử dụng hashtag #AnDo là bao nhiêu?';
    const result = await ragService.query(query);
    const h = result.evidence?.metrics?.hashtag;
    const count = h.population.count;
    const sum = h.aggregation.sum;
    const avg = h.aggregation.avg;

    assert.equal(count, 73);
    assert.equal(sum, 46375171);
    const calculatedAvg = Number((sum / count).toFixed(2));
    assert.equal(avg, calculatedAvg, 'AVG must deterministically equal SUM / COUNT');
  });

  test('fix1.md Anti-Top-K: Hashtag queries calculate over 100% of population without Top-K capping', async () => {
    const result = await ragService.query('Tổng lượt xem của hashtag #dulich là bao nhiêu?');
    const h = result.evidence?.metrics?.hashtag;
    assert.ok(h.population.count > 10, 'Population must not be capped at 10');
    assert.ok(h.population.count >= 260, 'Population must include all videos');
    assert.ok(h.aggregation.sum >= 323982413, 'Sum must include all views');
  });

  test('fix1.md Anti-Duplicate JOIN: Deduplication guarantees distinct video_id aggregation', () => {
    const stats = analyticsEngine.getHashtagAnalytics('ando', 'SUM', 'views');
    assert.equal(stats.population.count, 73);
    assert.equal(stats.aggregation.count, 73);
    assert.equal(stats.entity_ids.length, 73);
    const uniqueIds = new Set(stats.entity_ids);
    assert.equal(uniqueIds.size, 73, 'Every video_id must be unique (no duplicate JOIN rows)');
  });

  test('fix1.md Scope Isolation: CREATOR + #AnDo is strictly isolated from DATASET scope', async () => {
    const query = 'Kênh @khoailangthang có bao nhiêu video sử dụng hashtag #AnDo?';
    const plan = queryPlanner.plan(query);
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.creator, 'khoailangthang');
    assert.equal(plan.entities.hashtag, 'ando');

    const result = await ragService.query(query);
    const h = result.evidence?.metrics?.hashtag;
    assert.equal(h.scope, 'CREATOR');
    assert.equal(h.creator, '@khoailangthang');
    assert.equal(h.population.count, 5, 'Khoai Lang Thang has exactly 5 videos with #AnDo');
    assert.equal(h.aggregation.sum, 43300000);
    assert.equal(h.aggregation.avg, 8660000);
    assert.ok(result.answer.includes('5'), 'Answer must state 5 videos');
  });

  test('fix1.md Hashtag Intersection: Videos using both #dulich and #travel', async () => {
    const query = 'Có bao nhiêu video vừa dùng hashtag #dulich vừa dùng hashtag #travel?';
    const plan = queryPlanner.plan(query);
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.isHashtagIntersection, true);
    assert.deepEqual(plan.entities.hashtags, ['dulich', 'travel']);

    const result = await ragService.query(query);
    const h = result.evidence?.metrics?.hashtag;
    assert.equal(h.type, 'INTERSECTION');
    assert.ok(h.video_count >= 83, 'At least 83 videos contain both #dulich and #travel');
    assert.ok(h.total_views >= 176325602);
    assert.ok(result.answer.includes(String(h.video_count)), 'Answer must report video count');
  });

  test('fix1.md Hashtag Comparison: Deterministic side-by-side comparison between #dulich and #travel', async () => {
    const query = 'So sánh hashtag #dulich và #travel';
    const plan = queryPlanner.plan(query);
    assert.equal(plan.intent, 'HASHTAG_ANALYSIS');
    assert.equal(plan.entities.isHashtagComparison, true);
    assert.deepEqual(plan.entities.hashtags, ['dulich', 'travel']);

    const result = await ragService.query(query);
    const h = result.evidence?.metrics?.hashtag;
    assert.equal(h.type, 'COMPARISON');
    assert.ok(h.comparison.tag1.population.count >= 260);
    assert.ok(h.comparison.tag2.population.count >= 504);
    assert.equal(h.comparison.leader, '#travel');
    assert.ok(result.answer.includes('#travel') && result.answer.includes('#dulich'));
  });
});


