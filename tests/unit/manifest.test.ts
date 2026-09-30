import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  createInitialVideoManifest,
  isVideoCompleted,
} from '../../src/storage/manifest.js';

describe('Manifest & Resume Logic', () => {
  const testDir = path.resolve(process.cwd(), './data/test_manifest_dir');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create initial video manifest with pending stages and running status', () => {
    const manifest = createInitialVideoManifest('123456', 'https://www.tiktok.com/@u/video/123456');

    assert.equal(manifest.source, 'tiktok');
    assert.equal(manifest.video_id, '123456');
    assert.equal(manifest.status, 'running');
    assert.equal(manifest.stages.video.status, 'pending');
    assert.equal(manifest.stages.metadata.status, 'pending');
    assert.equal(manifest.stages.technical.status, 'pending');
  });

  it('isVideoCompleted should return false when files are missing', () => {
    assert.equal(isVideoCompleted(testDir), false);

    // Write manifest only
    fs.writeFileSync(
      path.join(testDir, 'manifest.json'),
      JSON.stringify({ status: 'completed' })
    );

    assert.equal(isVideoCompleted(testDir), false);
  });

  it('isVideoCompleted should return false when video file is 0 bytes (corrupt)', () => {
    fs.writeFileSync(path.join(testDir, 'manifest.json'), JSON.stringify({ status: 'completed' }));
    fs.writeFileSync(path.join(testDir, 'video.mp4'), ''); // 0 bytes
    fs.writeFileSync(path.join(testDir, 'metadata.json'), '{"id": 1}');
    fs.writeFileSync(path.join(testDir, 'technical.json'), '{"duration": 1}');

    assert.equal(isVideoCompleted(testDir), false);
  });

  it('isVideoCompleted should return true only when all required artifacts exist and are non-empty', () => {
    fs.writeFileSync(path.join(testDir, 'manifest.json'), JSON.stringify({ status: 'completed' }));
    fs.writeFileSync(path.join(testDir, 'video.mp4'), 'fake mp4 bytes content');
    fs.writeFileSync(path.join(testDir, 'metadata.json'), '{"id": 1}');
    fs.writeFileSync(path.join(testDir, 'technical.json'), '{"duration": 10}');

    assert.equal(isVideoCompleted(testDir), true);
  });
});
