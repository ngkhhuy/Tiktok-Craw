import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { resolveProfileHttp } from '../../src/acquisition/tiktok/http/profile.js';
import { localStorage } from '../../src/storage/local-storage.js';

describe('Profile Pipeline Integration', () => {
  let resolvedProfile: any;

  it('should resolve real public TikTok profile via direct HTTP', async () => {
    resolvedProfile = await resolveProfileHttp('tiktok');

    assert.equal(resolvedProfile.platform, 'tiktok');
    assert.equal(resolvedProfile.username, 'tiktok');
    assert.ok(resolvedProfile.profile_id);
    assert.ok(resolvedProfile.stats.followers > 1000000);
    assert.ok(resolvedProfile.stats.videos > 100);
    assert.ok(resolvedProfile.avatar_url);
    assert.ok(resolvedProfile.sec_uid);

    // Save profile metadata & initial manifest so the directory test always has valid test data
    const profileDir = localStorage.getProfileDir(resolvedProfile.profile_id);
    await localStorage.ensureDir(profileDir);
    await localStorage.writeJson(path.join(profileDir, 'profile.json'), resolvedProfile);
    const manifestPath = path.join(profileDir, 'crawl-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      await localStorage.writeJson(manifestPath, {
        platform: 'tiktok',
        profile_id: resolvedProfile.profile_id,
        username: resolvedProfile.username,
        profile_url: resolvedProfile.profile_url,
        stats: { discovered: 0, completed: 0, skipped: 0, failed: 0, pending: 0 },
        videos: {},
      });
    }
  });

  it('should verify profile dataset folder and crawl-manifest.json', async () => {
    const profilesBase = path.join(process.cwd(), 'data', 'profiles');
    const existingProfiles = fs.existsSync(profilesBase) ? fs.readdirSync(profilesBase) : [];
    const profileId = resolvedProfile?.profile_id || existingProfiles[0] || '107955';
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
