import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTikWMVideo,
  normalizeTikWMComment,
  extractHashtagsFromText,
  extractMentionsFromTikWM,
} from '../../src/acquisition/tiktok/thirdparty/tikwm.js';
import { TikTokAcquisitionService } from '../../src/acquisition/tiktok/index.js';
import { config } from '../../src/config/index.js';

describe('TikWM 3rd-party Normalization & Fallback Flow', () => {
  it('should normalize standard TikWM video data correctly', () => {
    const rawData = {
      id: '7677074241539280148',
      title: 'Database: Nếu 2 người cùng chuyển tiền thì sao? #SQL #Database #DataAnalyst @techlead',
      create_time: 1787458152,
      duration: 136,
      play: 'https://cdn.tikwm.com/video.mp4',
      hdplay: 'https://cdn.tikwm.com/video_hd.mp4',
      origin_cover: 'https://cdn.tikwm.com/cover.jpg',
      play_count: 1500000,
      digg_count: 75000,
      comment_count: 450,
      share_count: 10000,
      collect_count: 3200,
      author: {
        id: '7369265414528910353',
        unique_id: 'lap_trinh_vn',
        nickname: 'Học lập trình',
        avatar: 'https://cdn.tikwm.com/avatar.jpg',
      },
      music_info: {
        id: '7677074289955900167',
        title: 'original sound - lap_trinh_vn',
        author: 'Học lập trình',
        play: 'https://cdn.tikwm.com/music.mp3',
      },
    };

    const normalized = normalizeTikWMVideo(
      rawData,
      'https://www.tiktok.com/@lap_trinh_vn/video/7677074241539280148'
    );

    assert.equal(normalized.source, 'tiktok');
    assert.equal(normalized.video_id, '7677074241539280148');
    assert.equal(normalized.canonical_url, 'https://www.tiktok.com/@lap_trinh_vn/video/7677074241539280148');
    assert.equal(normalized.author.username, 'lap_trinh_vn');
    assert.equal(normalized.author.display_name, 'Học lập trình');
    assert.equal(normalized.author.id, '7369265414528910353');
    assert.deepEqual(normalized.content.hashtags, ['SQL', 'Database', 'DataAnalyst']);
    assert.deepEqual(normalized.content.mentions, ['techlead']);
    assert.equal(normalized.engagement.views, 1500000);
    assert.equal(normalized.engagement.likes, 75000);
    assert.equal(normalized.engagement.comments, 450);
    assert.equal(normalized.engagement.shares, 10000);
    assert.equal(normalized.engagement.saves, 3200);
    assert.equal(normalized.media.video_url, 'https://cdn.tikwm.com/video_hd.mp4');
    assert.equal(normalized.media.thumbnail_url, 'https://cdn.tikwm.com/cover.jpg');
    assert.equal(normalized.media.duration, 136);
    assert.equal(normalized.media.is_photo_mode, false);
    assert.equal(normalized.platform_specific.provider, 'tikwm');
  });

  it('should normalize photo mode (slideshow) video from TikWM', () => {
    const rawPhotoData = {
      id: '7629355590308941064',
      title: 'Chuyến đi tuyệt vời ❤️ #khoailangthang',
      create_time: 1776347777,
      images: [
        'https://cdn.tikwm.com/img1.jpg',
        'https://cdn.tikwm.com/img2.jpg',
        'https://cdn.tikwm.com/img3.jpg',
      ],
      music: 'https://cdn.tikwm.com/photo_audio.mp3',
      author: {
        id: '12345',
        unique_id: 'khoailangthang',
        nickname: 'Khoai Lang Thang',
      },
      play_count: 500000,
    };

    const normalized = normalizeTikWMVideo(
      rawPhotoData,
      'https://www.tiktok.com/@khoailangthang/video/7629355590308941064'
    );

    assert.equal(normalized.media.is_photo_mode, true);
    assert.equal(normalized.media.video_url, null);
    assert.equal(normalized.media.images?.length, 3);
    assert.equal(normalized.media.music_url, 'https://cdn.tikwm.com/photo_audio.mp3');
  });

  it('should normalize comments from TikWM including replies', () => {
    const rawComment = {
      id: '1122334455',
      text: 'Video rất hay và hữu ích!',
      create_time: 1787474180,
      digg_count: 250,
      reply_total: 5,
      user: {
        id: '998877',
        unique_id: 'user_fan',
        nickname: 'Fan Cứng',
        avatar: 'https://cdn.tikwm.com/fan.jpg',
      },
    };

    const topComment = normalizeTikWMComment(rawComment, '7677074241539280148', null);
    assert.equal(topComment.comment_id, '1122334455');
    assert.equal(topComment.author.username, 'user_fan');
    assert.equal(topComment.text, 'Video rất hay và hữu ích!');
    assert.equal(topComment.like_count, 250);
    assert.equal(topComment.is_reply, false);
    assert.equal(topComment.parent_comment_id, null);

    const rawReply = {
      id: '9988776655',
      text: 'Đồng ý với bạn nè!',
      create_time: 1787474500,
      digg_count: 12,
      user: {
        id: '554433',
        unique_id: 'user_reply',
        nickname: 'Người Trả Lời',
      },
    };

    const replyComment = normalizeTikWMComment(rawReply, '7677074241539280148', topComment.comment_id);
    assert.equal(replyComment.is_reply, true);
    assert.equal(replyComment.parent_comment_id, '1122334455');
    assert.equal(replyComment.author.username, 'user_reply');
  });

  it('should prioritize TikWM first when enabled', async () => {
    const service = new TikTokAcquisitionService();
    const originalEnable = config.enableTikwm;
    config.enableTikwm = true;

    const mockTikwmService = await import('../../src/acquisition/tiktok/thirdparty/tikwm.js');
    const originalFetchVideo = mockTikwmService.tikwmService.fetchVideo;

    let tikwmCalled = false;
    mockTikwmService.tikwmService.fetchVideo = async (url: string) => {
      tikwmCalled = true;
      return {
        source: 'tiktok',
        video_id: '123456789',
        url,
        canonical_url: url,
        author: { id: '1', username: 'mock_user', display_name: 'Mock', avatar_url: null },
        content: { description: 'Mock', hashtags: [], mentions: [], music: null },
        engagement: { views: 100, likes: 10, comments: 2, shares: 1, saves: 0 },
        published_at: null,
        media: { video_url: 'https://mock.com/video.mp4', thumbnail_url: null, duration: 10, width: null, height: null },
        platform_specific: { provider: 'tikwm' },
      };
    };

    try {
      const video = await service.getVideo('https://www.tiktok.com/@mock_user/video/123456789');
      assert.equal(tikwmCalled, true, 'TikWM must be invoked first');
      assert.equal(video.video_id, '123456789');
      assert.equal(video.platform_specific.provider, 'tikwm');
    } finally {
      mockTikwmService.tikwmService.fetchVideo = originalFetchVideo;
      config.enableTikwm = originalEnable;
    }
  });

  it('should fallback to HTTP then Playwright when TikWM fails', async () => {
    const service = new TikTokAcquisitionService();
    const originalEnable = config.enableTikwm;
    config.enableTikwm = true;

    const mockTikwmService = await import('../../src/acquisition/tiktok/thirdparty/tikwm.js');
    const { browserFallback } = await import('../../src/acquisition/tiktok/browser/fallback.js');
    const originalFetchVideo = mockTikwmService.tikwmService.fetchVideo;
    const originalBrowserFallback = browserFallback.getVideoMetadata;

    let tikwmAttempted = false;
    let browserAttempted = false;

    mockTikwmService.tikwmService.fetchVideo = async () => {
      tikwmAttempted = true;
      throw new Error('TikWM temporary outage');
    };

    browserFallback.getVideoMetadata = async (url: string) => {
      browserAttempted = true;
      return {
        source: 'tiktok',
        video_id: 'browser_fallback_id',
        url,
        canonical_url: url,
        author: { id: '2', username: 'browser_user', display_name: 'Browser User', avatar_url: null },
        content: { description: 'From Browser', hashtags: [], mentions: [], music: null },
        engagement: { views: 200, likes: 20, comments: 4, shares: 2, saves: 1 },
        published_at: null,
        media: { video_url: 'https://browser.com/video.mp4', thumbnail_url: null, duration: 20, width: null, height: null },
        platform_specific: { provider: 'browser_fallback' },
      };
    };

    try {
      // Calling with immediately unreachable URL triggers TikWM -> fails -> triggers HTTP -> fails -> triggers Browser Fallback!
      const res = await service.getVideo('http://127.0.0.1:9/video/111');
      assert.equal(tikwmAttempted, true, 'TikWM must have been attempted first');
      assert.equal(browserAttempted, true, 'Browser fallback must have been invoked after HTTP failure');
      assert.equal(res.video_id, 'browser_fallback_id');
    } finally {
      mockTikwmService.tikwmService.fetchVideo = originalFetchVideo;
      browserFallback.getVideoMetadata = originalBrowserFallback;
      config.enableTikwm = originalEnable;
    }
  });
});


