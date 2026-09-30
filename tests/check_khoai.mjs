import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('./data/index.db');
const stats = db.prepare("SELECT status, COUNT(*) as cnt FROM videos WHERE username = 'khoailangthang' GROUP BY status").all();
console.log('KHOAI VIDEO STATUSES:', stats);

// Check crawl-manifest.json in profile folder
const manifestPath = path.join('./data/profiles/6591472415795298306/crawl-manifest.json');
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log('MANIFEST:', {
    profile_id: m.profile_id,
    discovered: m.discovered_video_ids?.length,
    completed: m.completed_video_ids?.length,
    failed: m.failed_video_ids?.length,
    status: m.status,
    total_videos: m.total_videos,
  });
  console.log('Discovered first 5:', m.discovered_video_ids?.slice(0, 5));
  console.log('Completed count:', m.completed_video_ids?.length);
} else {
  console.log('Manifest not found at', manifestPath);
}

// Check recent crawl logs or console
const profileRow = db.prepare("SELECT * FROM profiles WHERE username = 'khoailangthang'").get();
console.log('PROFILE ROW:', profileRow);
