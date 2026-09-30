import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { resolveProfileHttp } from '../../src/acquisition/tiktok/http/profile.js';
import { localStorage } from '../../src/storage/local-storage.js';

describe('Profile Pipeline Integration', () => {
  it('should resolve real public TikTok profile via direct HTTP', async () => {
    const profile = await resolveProfileHttp('tiktok');

    assert.equal(profile.platform, 'tiktok');
    assert.equal(profile.username, 'tiktok');
    assert.ok(profile.profile_id);
    assert.ok(profile.stats.followers > 1000000);
    assert.ok(profile.stats.videos > 100);
    assert.ok(profile.avatar_url);
    assert.ok(profile.sec_uid);
  });

  it('should verify profile dataset folder and crawl-manifest.json', async () => {
    const profilesBase = path.join(process.cwd(), 'data', 'profiles');
    const existingProfiles = fs.existsSync(profilesBase) ? fs.readdirSync(profilesBase) : [];
    const profileId = existingProfiles[0] || '107955';
    const profileDir = localStorage.getProfileDir(profileId);

    assert.ok(fs.existsSync(profileDir), 'Profile directory must exist');

    const profileJsonPath = path.join(profileDir, 'profile.json');
    assert.ok(fs.existsSync(profileJsonPath), 'profile.json must exist');
    const profile = JSON.parse(fs.readFileSync(profileJsonPath, 'utf-8'));
    assert.ok(profile.username);

    const crawlManifestPath = path.join(profileDir, 'crawl-manifest.json');
    assert.ok(fs.existsSync(crawlManifestPath), 'crawl-manifest.json must exist');
    const crawlManifest = JSON.parse(fs.readFileSync(crawlManifestPath, 'utf-8'));
    assert.ok(crawlManifest.platform === 'tiktok');

    if (crawlManifest.stats.completed > 0) {
      const videosDir = path.join(profileDir, 'videos');
      assert.ok(fs.existsSync(videosDir), 'videos directory must exist');
      const videoDirs = fs.readdirSync(videosDir);
      if (videoDirs.length > 0) {
        const firstVidDir = path.join(videosDir, videoDirs[0]);
        if (fs.existsSync(path.join(firstVidDir, 'video.mp4'))) {
          assert.ok(fs.statSync(path.join(firstVidDir, 'video.mp4')).size > 10000, 'video.mp4 must be non-empty');
        }
      }
    }
  });
});
