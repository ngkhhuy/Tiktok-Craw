import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

export interface Storage {
  exists(targetPath: string): Promise<boolean>;
  write(targetPath: string, data: string | Buffer): Promise<void>;
  read(targetPath: string): Promise<string>;
  remove(targetPath: string): Promise<void>;
  ensureDir(dirPath: string): Promise<void>;
  getPath(...segments: string[]): string;
}

export class LocalStorage implements Storage {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || config.dataDir;
    this.ensureDirSync(this.baseDir);
  }

  getPath(...segments: string[]): string {
    return path.resolve(this.baseDir, ...segments);
  }

  /**
   * Get the sharded video directory path.
   * Uses 2-level sharding based on video_id characters to keep each folder < 1000 entries.
   * Example: video_id "7689814919914458374" → data/videos/76/89/7689814919914458374/
   */
  getVideoDir(videoId: string, profileId?: string): string {
    const shard1 = videoId.slice(0, 2);
    const shard2 = videoId.slice(2, 4);
    if (profileId) {
      return this.getPath('profiles', profileId, 'videos', shard1, shard2, videoId);
    }
    return this.getPath('videos', shard1, shard2, videoId);
  }

  /**
   * Find a video directory, checking both new sharded and legacy flat paths.
   * Essential for backward compatibility with existing data.
   */
  findVideoDir(videoId: string, profileId?: string): string | null {
    // 1. Check new sharded path first
    const shardedPath = this.getVideoDir(videoId, profileId);
    if (fs.existsSync(shardedPath)) return shardedPath;

    // 2. Check legacy flat path
    if (profileId) {
      const legacyPath = this.getPath('profiles', profileId, 'videos', videoId);
      if (fs.existsSync(legacyPath)) return legacyPath;
    }
    const legacySinglePath = this.getPath('videos', videoId);
    if (fs.existsSync(legacySinglePath)) return legacySinglePath;

    // 3. Search across all profiles (legacy)
    const profilesDir = this.getPath('profiles');
    if (fs.existsSync(profilesDir)) {
      try {
        const pEntries = fs.readdirSync(profilesDir);
        for (const p of pEntries) {
          // Check sharded path under each profile
          const shard1 = videoId.slice(0, 2);
          const shard2 = videoId.slice(2, 4);
          const candidate1 = this.getPath('profiles', p, 'videos', shard1, shard2, videoId);
          if (fs.existsSync(candidate1)) return candidate1;
          // Check legacy flat path under each profile
          const candidate2 = this.getPath('profiles', p, 'videos', videoId);
          if (fs.existsSync(candidate2)) return candidate2;
        }
      } catch {}
    }

    return null;
  }

  getProfileDir(profileId: string): string {
    return this.getPath('profiles', profileId);
  }

  async exists(targetPath: string): Promise<boolean> {
    const full = path.isAbsolute(targetPath) ? targetPath : this.getPath(targetPath);
    return fs.existsSync(full);
  }

  async ensureDir(dirPath: string): Promise<void> {
    const full = path.isAbsolute(dirPath) ? dirPath : this.getPath(dirPath);
    await fs.promises.mkdir(full, { recursive: true });
  }

  ensureDirSync(dirPath: string): void {
    const full = path.isAbsolute(dirPath) ? dirPath : this.getPath(dirPath);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  }

  async write(targetPath: string, data: string | Buffer): Promise<void> {
    const full = path.isAbsolute(targetPath) ? targetPath : this.getPath(targetPath);
    const dir = path.dirname(full);
    await this.ensureDir(dir);

    // Atomic write via temp file
    const tmp = `${full}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, full);
  }

  async writeJson(targetPath: string, data: any): Promise<void> {
    const formatted = JSON.stringify(data, null, 2);
    await this.write(targetPath, formatted);
  }

  async read(targetPath: string): Promise<string> {
    const full = path.isAbsolute(targetPath) ? targetPath : this.getPath(targetPath);
    return await fs.promises.readFile(full, 'utf-8');
  }

  async readJson<T = any>(targetPath: string): Promise<T | null> {
    try {
      const content = await this.read(targetPath);
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async remove(targetPath: string): Promise<void> {
    const full = path.isAbsolute(targetPath) ? targetPath : this.getPath(targetPath);
    if (fs.existsSync(full)) {
      await fs.promises.rm(full, { recursive: true, force: true });
    }
  }
}

export const localStorage = new LocalStorage();
