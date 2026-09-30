import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface TechnicalMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  video_codec: string;
  audio_codec: string | null;
  audio_sample_rate: number | null;
  audio_channels: number | null;
  bitrate: number;
  container: string;
  file_size: number;
  streams_count?: number;
}

export async function runFfprobe(filePath: string): Promise<TechnicalMetadata> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist for ffprobe: ${filePath}`);
  }

  const ffprobeBin = config.ffprobePath;
  logger.stage('ffprobe', `Analyzing media technical metadata with ffprobe (${ffprobeBin})`);

  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  let stdout: string;
  try {
    const res = await execFileAsync(ffprobeBin, args, { timeout: 30000 });
    stdout = res.stdout;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`ffprobe executable not found at "${ffprobeBin}". Please ensure ffprobe is installed in PATH or specify FFPROBE_PATH in .env`);
    }
    throw new Error(`ffprobe execution failed: ${err.message}`);
  }

  let probeData: any;
  try {
    probeData = JSON.parse(stdout);
  } catch (e: any) {
    throw new Error(`Failed to parse ffprobe output: ${e.message}`);
  }

  const format = probeData.format || {};
  const streams: any[] = probeData.streams || [];

  const videoStream = streams.find((s: any) => s.codec_type === 'video');
  const audioStream = streams.find((s: any) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('ffprobe did not find any video stream in the file');
  }

  // Calculate FPS from r_frame_rate or avg_frame_rate (e.g. "30/1" or "2997/100")
  let fps = 0;
  const fpsStr = videoStream.r_frame_rate || videoStream.avg_frame_rate || '';
  if (fpsStr && fpsStr.includes('/')) {
    const [num, den] = fpsStr.split('/').map(Number);
    if (den && den > 0) {
      fps = Math.round((num / den) * 100) / 100;
    }
  }

  const duration = Number(format.duration || videoStream.duration || 0);
  const width = Number(videoStream.width || 0);
  const height = Number(videoStream.height || 0);
  const fileSize = Number(format.size || fs.statSync(filePath).size);
  const bitrate = Number(format.bit_rate || videoStream.bit_rate || 0);

  const technical: TechnicalMetadata = {
    duration,
    width,
    height,
    fps,
    video_codec: videoStream.codec_name || 'unknown',
    audio_codec: audioStream?.codec_name || null,
    audio_sample_rate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : null,
    audio_channels: audioStream?.channels ? Number(audioStream.channels) : null,
    bitrate,
    container: format.format_name || 'mp4',
    file_size: fileSize,
    streams_count: streams.length,
  };

  logger.stage('ffprobe', `Extracted: ${technical.width}x${technical.height} @ ${technical.fps}fps, codec: ${technical.video_codec}, duration: ${technical.duration.toFixed(2)}s`);

  return technical;
}
