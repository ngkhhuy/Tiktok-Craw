import fs from 'fs';
import path from 'path';
import { localStorage } from './local-storage.js';
import { VideoManifest, ProfileCrawlManifest, StageStatus } from './types.js';

export function isVideoCompleted(videoDir: string): boolean {
  const manifestPath = path.join(videoDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return false;

  try {
    const manifest: VideoManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (manifest.status !== 'completed') return false;

    // Validate actual files on disk
    const videoFile = path.join(videoDir, 'video.mp4');
    if (!fs.existsSync(videoFile) || fs.statSync(videoFile).size === 0) {
      return false;
    }

    const metadataFile = path.join(videoDir, 'metadata.json');
    if (!fs.existsSync(metadataFile) || fs.statSync(metadataFile).size === 0) {
      return false;
    }

    const technicalFile = path.join(videoDir, 'technical.json');
    if (!fs.existsSync(technicalFile) || fs.statSync(technicalFile).size === 0) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function createInitialVideoManifest(videoId: string, url: string): VideoManifest {
  const now = new Date().toISOString();
  return {
    source: 'tiktok',
    video_id: videoId,
    url,
    started_at: now,
    status: 'running',
    stages: {
      metadata: { status: 'pending' },
      video: { status: 'pending' },
      thumbnail: { status: 'pending' },
      technical: { status: 'pending' },
      comments: { status: 'pending' },
      hash: { status: 'pending' },
    },
    files: {},
  };
}

export async function saveVideoManifest(videoDir: string, manifest: VideoManifest): Promise<void> {
  const manifestPath = path.join(videoDir, 'manifest.json');
  await localStorage.writeJson(manifestPath, manifest);
}

export async function loadVideoManifest(videoDir: string): Promise<VideoManifest | null> {
  const manifestPath = path.join(videoDir, 'manifest.json');
  return await localStorage.readJson<VideoManifest>(manifestPath);
}

export async function initProfileCrawlManifest(
  profileId: string,
  username: string,
  profileUrl: string,
  totalDiscovered: number = 0
): Promise<ProfileCrawlManifest> {
  const now = new Date().toISOString();
  const profileDir = localStorage.getProfileDir(profileId);
  const manifestPath = path.join(profileDir, 'crawl-manifest.json');

  // Load existing if available to preserve history
  const existing = await localStorage.readJson<ProfileCrawlManifest>(manifestPath);
  if (existing) {
    existing.updated_at = now;
    existing.stats.discovered = Math.max(existing.stats.discovered, totalDiscovered);
    return existing;
  }

  const newManifest: ProfileCrawlManifest = {
    platform: 'tiktok',
    profile_id: profileId,
    username,
    profile_url: profileUrl,
    started_at: now,
    updated_at: now,
    status: 'running',
    stats: {
      discovered: totalDiscovered,
      completed: 0,
      skipped: 0,
      failed: 0,
      pending: totalDiscovered,
    },
    videos: {},
  };

  await localStorage.writeJson(manifestPath, newManifest);
  return newManifest;
}

export async function updateProfileCrawlVideo(
  profileId: string,
  videoId: string,
  status: StageStatus,
  error?: string
): Promise<void> {
  const profileDir = localStorage.getProfileDir(profileId);
  const manifestPath = path.join(profileDir, 'crawl-manifest.json');
  const manifest = await localStorage.readJson<ProfileCrawlManifest>(manifestPath);

  if (!manifest) return;

  const now = new Date().toISOString();
  const existing = manifest.videos[videoId] || { attempts: 0, status: 'pending' };

  manifest.videos[videoId] = {
    status,
    attempts: existing.attempts + 1,
    started_at: existing.started_at || now,
    completed_at: status === 'completed' || status === 'failed' || status === 'skipped' ? now : undefined,
    error,
  };

  // Recompute stats
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let pending = 0;

  for (const v of Object.values(manifest.videos)) {
    if (v.status === 'completed') completed++;
    else if (v.status === 'skipped') skipped++;
    else if (v.status === 'failed') failed++;
    else pending++;
  }

  manifest.stats.completed = completed;
  manifest.stats.skipped = skipped;
  manifest.stats.failed = failed;
  manifest.stats.pending = Math.max(0, manifest.stats.discovered - completed - skipped - failed);
  manifest.updated_at = now;

  await localStorage.writeJson(manifestPath, manifest);
}

export async function finalizeProfileCrawl(
  profileId: string,
  status: 'completed' | 'interrupted' | 'failed' = 'completed'
): Promise<ProfileCrawlManifest | null> {
  const profileDir = localStorage.getProfileDir(profileId);
  const manifestPath = path.join(profileDir, 'crawl-manifest.json');
  const manifest = await localStorage.readJson<ProfileCrawlManifest>(manifestPath);

  if (!manifest) return null;

  manifest.status = status;
  manifest.updated_at = new Date().toISOString();
  await localStorage.writeJson(manifestPath, manifest);
  return manifest;
}
