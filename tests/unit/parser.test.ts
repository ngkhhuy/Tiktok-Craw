import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTikTokUrl, buildCanonicalVideoUrl, buildCanonicalProfileUrl } from '../../src/acquisition/tiktok/parser.js';

describe('TikTok URL Parser', () => {
  it('should parse standard desktop video URLs with @username', () => {
    const url = 'https://www.tiktok.com/@tiktok/video/7106594312292453675';
    const result = parseTikTokUrl(url);

    assert.equal(result.type, 'video');
    assert.equal(result.videoId, '7106594312292453675');
    assert.equal(result.username, 'tiktok');
    assert.equal(result.canonicalUrl, 'https://www.tiktok.com/@tiktok/video/7106594312292453675');
  });

  it('should parse video URLs with query parameters and fragments', () => {
    const url = 'https://www.tiktok.com/@creator.name/video/7234567890123456789?is_from_webapp=1&sender_device=pc#comment-section';
    const result = parseTikTokUrl(url);

    assert.equal(result.type, 'video');
    assert.equal(result.videoId, '7234567890123456789');
    assert.equal(result.username, 'creator.name');
    assert.equal(result.canonicalUrl, 'https://www.tiktok.com/@creator.name/video/7234567890123456789');
  });

  it('should parse video URLs without username prefix (/video/123)', () => {
    const url = 'https://www.tiktok.com/video/7106594312292453675';
    const result = parseTikTokUrl(url);

    assert.equal(result.type, 'video');
    assert.equal(result.videoId, '7106594312292453675');
    assert.equal(result.canonicalUrl, 'https://www.tiktok.com/video/7106594312292453675');
  });

  it('should detect short URLs (vm.tiktok.com, vt.tiktok.com, /t/)', () => {
    const vm = parseTikTokUrl('https://vm.tiktok.com/ZMh5yU7G8/');
    assert.equal(vm.type, 'short');

    const vt = parseTikTokUrl('https://vt.tiktok.com/ZS2V8wXq1/');
    assert.equal(vt.type, 'short');

    const t = parseTikTokUrl('https://www.tiktok.com/t/ZT8R12345/');
    assert.equal(t.type, 'short');
  });

  it('should parse profile URLs', () => {
    const standard = parseTikTokUrl('https://www.tiktok.com/@khaby.lame');
    assert.equal(standard.type, 'profile');
    assert.equal(standard.username, 'khaby.lame');
    assert.equal(standard.canonicalUrl, 'https://www.tiktok.com/@khaby.lame');

    const trailingSlash = parseTikTokUrl('https://www.tiktok.com/@mrbeast/');
    assert.equal(trailingSlash.type, 'profile');
    assert.equal(trailingSlash.username, 'mrbeast');
    assert.equal(trailingSlash.canonicalUrl, 'https://www.tiktok.com/@mrbeast');
  });

  it('should handle malformed and non-TikTok URLs gracefully without throwing', () => {
    const invalid = parseTikTokUrl('not a url');
    assert.equal(invalid.type, 'unknown');

    const otherSite = parseTikTokUrl('https://www.google.com/search?q=tiktok');
    assert.equal(otherSite.type, 'unknown');

    const empty = parseTikTokUrl('');
    assert.equal(empty.type, 'unknown');
  });

  it('should build canonical video and profile URLs properly', () => {
    assert.equal(
      buildCanonicalVideoUrl('username', '123456'),
      'https://www.tiktok.com/@username/video/123456'
    );
    assert.equal(
      buildCanonicalVideoUrl('@username', '123456'),
      'https://www.tiktok.com/@username/video/123456'
    );
    assert.equal(
      buildCanonicalProfileUrl('@creator'),
      'https://www.tiktok.com/@creator'
    );
  });
});
