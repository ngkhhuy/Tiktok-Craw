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

  getVideoDir(videoId: string, profileId?: string): string {
    if (profileId) {
      return this.getPath('profiles', profileId, 'videos', videoId);
    }
    return this.getPath('videos', videoId);
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
