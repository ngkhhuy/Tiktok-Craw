import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function testSlideshow() {
  const dir = 'E:/TikTok Craw/data/profiles/7196544807786267654/videos/7690399709365669140';
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
  const images = meta.platform_specific?.imagePost?.images || [];
  const musicUrl = meta.platform_specific?.music?.playUrl;

  const imagesDir = path.join(dir, 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  console.log('Downloading', images.length, 'images...');
  const imgFiles = [];
  for (let i = 0; i < images.length; i++) {
    const url = images[i].imageURL?.urlList?.[0];
    const out = path.join(imagesDir, `img_${i}.jpg`);
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(out, buf);
    imgFiles.push(out);
  }

  let audioFile = null;
  if (musicUrl) {
    console.log('Downloading music...');
    const aRes = await fetch(musicUrl);
    const aBuf = Buffer.from(await aRes.arrayBuffer());
    audioFile = path.join(dir, 'audio.mp3');
    fs.writeFileSync(audioFile, aBuf);
  }

  const concatFile = path.join(dir, 'concat.txt');
  let concatContent = '';
  for (const f of imgFiles) {
    concatContent += `file '${f.replace(/\\/g, '/')}'\n`;
    concatContent += 'duration 3.0\n';
  }
  concatContent += `file '${imgFiles[imgFiles.length - 1].replace(/\\/g, '/')}'\n`;
  fs.writeFileSync(concatFile, concatContent);

  const ffmpeg = 'C:/Users/ngkhh/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe';
  const outVideo = path.join(dir, 'video.mp4');

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
  ];

  if (audioFile) {
    args.push('-i', audioFile);
    args.push(
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:a', 'aac',
      '-shortest',
      outVideo
    );
  } else {
    args.push(
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      outVideo
    );
  }

  console.log('Running FFmpeg...');
  await execFileAsync(ffmpeg, args);
  console.log('Created video.mp4, size:', fs.statSync(outVideo).size);
}

testSlideshow().catch(console.error);
