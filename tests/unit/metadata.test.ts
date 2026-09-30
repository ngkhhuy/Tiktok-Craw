import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoMetadata } from '../../src/acquisition/tiktok/http/video.js';
import { normalizeProfileData } from '../../src/acquisition/tiktok/http/profile.js';

describe('Metadata Normalization', () => {
  it('should normalize full video metadata correctly', () => {
    const rawItemStruct = {
      id: '7106594312292453675',
      desc: 'Exploring the nature 🌿 with @friend #nature #travel',
      createTime: '1654789200',
      author: {
        id: '107955',
        uniqueId: 'nature_explorer',
        nickname: 'Nature Explorer 🌍',
        avatarLarger: 'https://p16.tiktokcdn.com/avatar.jpg',
      },
      challenges: [
        { title: 'nature' },
        { title: 'travel' }
      ],
      textExtra: [
        { userUniqueId: 'friend' }
      ],
      stats: {
        playCount: 150000,
        diggCount: 25000,
        commentCount: 1200,
        shareCount: 450,
        collectCount: 300,
      },
      music: {
        id: '888777666',
        title: 'Original Nature Audio',
        authorName: 'Nature Explorer 🌍',
      },
      video: {
        playAddr: 'https://v16.tiktok.com/video.mp4',
        cover: 'https://p16.tiktokcdn.com/cover.jpg',
        duration: 35,
        width: 1080,
        height: 1920,
      },
    };

    const normalized = normalizeVideoMetadata(
      rawItemStruct,
      'https://www.tiktok.com/@nature_explorer/video/7106594312292453675',
      'session_cookie=123'
    );

    assert.equal(normalized.source, 'tiktok');
    assert.equal(normalized.video_id, '7106594312292453675');
    assert.equal(normalized.author.username, 'nature_explorer');
    assert.equal(normalized.author.display_name, 'Nature Explorer 🌍');
    assert.equal(normalized.author.id, '107955');
    assert.equal(normalized.content.description, 'Exploring the nature 🌿 with @friend #nature #travel');
    assert.deepEqual(normalized.content.hashtags, ['nature', 'travel']);
    assert.deepEqual(normalized.content.mentions, ['friend']);
    assert.equal(normalized.engagement.views, 150000);
    assert.equal(normalized.engagement.likes, 25000);
    assert.equal(normalized.engagement.comments, 1200);
    assert.equal(normalized.engagement.shares, 450);
    assert.equal(normalized.engagement.saves, 300);
    assert.equal(normalized.published_at, new Date(1654789200 * 1000).toISOString());
    assert.equal(normalized.media.video_url, 'https://v16.tiktok.com/video.mp4');
    assert.equal(normalized.media.thumbnail_url, 'https://p16.tiktokcdn.com/cover.jpg');
    assert.equal(normalized.media.duration, 35);
    assert.equal(normalized.media.width, 1080);
    assert.equal(normalized.media.height, 1920);
    assert.equal(normalized.cookies, 'session_cookie=123');
  });

  it('should handle missing optional fields with null rather than fabricating fake data', () => {
    const minimalItemStruct = {
      id: '1234567890',
      desc: '',
      author: {
        uniqueId: 'minimal_user',
      },
    };

    const normalized = normalizeVideoMetadata(
      minimalItemStruct,
      'https://www.tiktok.com/@minimal_user/video/1234567890'
    );

    assert.equal(normalized.video_id, '1234567890');
    assert.equal(normalized.author.id, null);
    assert.equal(normalized.author.display_name, null);
    assert.equal(normalized.author.avatar_url, null);
    assert.equal(normalized.content.music, null);
    assert.equal(normalized.published_at, null);
    assert.equal(normalized.media.video_url, null);
    assert.equal(normalized.media.thumbnail_url, null);
    assert.equal(normalized.media.duration, null);
    assert.equal(normalized.media.width, null);
    assert.equal(normalized.media.height, null);
    assert.equal(normalized.engagement.views, 0);
  });

  it('should normalize profile data properly', () => {
    const rawUserDetail = {
      userInfo: {
        user: {
          id: '998877',
          uniqueId: 'creator_pro',
          nickname: 'Creator ✨',
          avatarLarger: 'https://p16.tiktokcdn.com/avatar.jpg',
          signature: 'Official TikTok Account 🚀',
          secUid: 'MS4wLjABAAAAsecuid123',
        },
        stats: {
          followerCount: 5000000,
          followingCount: 120,
          heartCount: 95000000,
          videoCount: 350,
        },
      },
    };

    const profile = normalizeProfileData(rawUserDetail, 'creator_pro');

    assert.equal(profile.platform, 'tiktok');
    assert.equal(profile.profile_id, '998877');
    assert.equal(profile.username, 'creator_pro');
    assert.equal(profile.display_name, 'Creator ✨');
    assert.equal(profile.sec_uid, 'MS4wLjABAAAAsecuid123');
    assert.equal(profile.bio, 'Official TikTok Account 🚀');
    assert.equal(profile.stats.followers, 5000000);
    assert.equal(profile.stats.following, 120);
    assert.equal(profile.stats.likes, 95000000);
    assert.equal(profile.stats.videos, 350);
  });
});
