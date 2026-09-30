import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

function getEnvNumber(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  return val.toLowerCase() === 'true' || val === '1';
}

function detectFfprobePath(): string {
  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH;
  }
  // Check known WinGet location on Windows
  const wingetBase = 'C:\\Users\\ngkhh\\AppData\\Local\\Microsoft\\WinGet\\Packages';
  if (fs.existsSync(wingetBase)) {
    try {
      const pkgs = fs.readdirSync(wingetBase);
      for (const pkg of pkgs) {
        if (pkg.toLowerCase().includes('ffmpeg')) {
          const candidate = path.join(wingetBase, pkg, 'ffmpeg-9.0.1-essentials_build', 'bin', 'ffprobe.exe');
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {}
  }
  return 'ffprobe';
}

function detectFfmpegPath(): string {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const wingetBase = 'C:\\Users\\ngkhh\\AppData\\Local\\Microsoft\\WinGet\\Packages';
  if (fs.existsSync(wingetBase)) {
    try {
      const pkgs = fs.readdirSync(wingetBase);
      for (const pkg of pkgs) {
        if (pkg.toLowerCase().includes('ffmpeg')) {
          const candidate = path.join(wingetBase, pkg, 'ffmpeg-9.0.1-essentials_build', 'bin', 'ffmpeg.exe');
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {}
  }
  return 'ffmpeg';
}

export const config = {
  videoConcurrency: getEnvNumber('TIKTOK_VIDEO_CONCURRENCY', 2),
  commentConcurrency: getEnvNumber('TIKTOK_COMMENT_CONCURRENCY', 2),
  requestDelayMs: getEnvNumber('TIKTOK_REQUEST_DELAY_MS', 500),
  maxCommentsPerVideo: getEnvNumber('MAX_COMMENTS_PER_VIDEO', 1000),
  maxCommentPages: getEnvNumber('MAX_COMMENT_PAGES', 20),
  maxRetries: getEnvNumber('MAX_RETRIES', 3),
  requestTimeoutMs: getEnvNumber('REQUEST_TIMEOUT_MS', 120000),
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR || './data'),
  headless: getEnvBoolean('HEADLESS', true),
  ffprobePath: detectFfprobePath(),
  ffmpegPath: detectFfmpegPath(),
  userAgentDesktop:
    process.env.USER_AGENT_DESKTOP ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  userAgentMobile:
    process.env.USER_AGENT_MOBILE ||
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};
