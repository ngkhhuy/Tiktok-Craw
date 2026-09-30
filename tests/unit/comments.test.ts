import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComment } from '../../src/acquisition/tiktok/http/comments.js';

describe('Comments Normalization', () => {
  it('should normalize top-level comment correctly', () => {
    const raw = {
      cid: '7106606555949433642',
      text: 'Amazing video! 👏',
      create_time: 1654789500,
      digg_count: 42,
      user: {
        uid: '12345678',
        unique_id: 'cool_viewer',
        nickname: 'Cool Viewer 😎',
        avatar_thumb: {
          url_list: ['https://p16.tiktokcdn.com/thumb.jpg'],
        },
      },
    };

    const normalized = normalizeComment(raw, '7106594312292453675');

    assert.equal(normalized.comment_id, '7106606555949433642');
    assert.equal(normalized.video_id, '7106594312292453675');
    assert.equal(normalized.parent_comment_id, null);
    assert.equal(normalized.is_reply, false);
    assert.equal(normalized.text, 'Amazing video! 👏');
    assert.equal(normalized.like_count, 42);
    assert.equal(normalized.author.id, '12345678');
    assert.equal(normalized.author.username, 'cool_viewer');
    assert.equal(normalized.author.display_name, 'Cool Viewer 😎');
    assert.equal(normalized.author.avatar_url, 'https://p16.tiktokcdn.com/thumb.jpg');
    assert.equal(normalized.published_at, new Date(1654789500 * 1000).toISOString());
  });

  it('should preserve parent_comment_id on replies without flattening', () => {
    const rawReply = {
      cid: '7106607890123456789',
      text: 'Totally agree with you!',
      create_time: 1654789600,
      digg_count: 5,
      user: {
        uid: '87654321',
        unique_id: 'replier',
      },
    };

    const normalizedReply = normalizeComment(rawReply, '7106594312292453675', '7106606555949433642');

    assert.equal(normalizedReply.comment_id, '7106607890123456789');
    assert.equal(normalizedReply.parent_comment_id, '7106606555949433642');
    assert.equal(normalizedReply.is_reply, true);
    assert.equal(normalizedReply.author.username, 'replier');
  });

  it('should deduplicate comments by comment_id', () => {
    const rawList = [
      { cid: '1', text: 'First' },
      { cid: '2', text: 'Second' },
      { cid: '1', text: 'First Duplicate' },
    ];

    const seen = new Set<string>();
    const deduplicated = [];

    for (const r of rawList) {
      const norm = normalizeComment(r, 'vid123');
      if (!seen.has(norm.comment_id)) {
        seen.add(norm.comment_id);
        deduplicated.push(norm);
      }
    }

    assert.equal(deduplicated.length, 2);
    assert.equal(deduplicated[0].comment_id, '1');
    assert.equal(deduplicated[1].comment_id, '2');
  });
});
