import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('./data/index.db');
const rows = db.prepare("SELECT video_id, directory, views, likes, comments_count, duration, file_size, updated_at FROM videos WHERE username = 'khoailangthang' ORDER BY updated_at DESC LIMIT 5").all();

for (const r of rows) {
  console.log(`\n--- VIDEO ${r.video_id} (${r.directory}) ---`);
  console.log(`Views: ${r.views}, Duration: ${r.duration}s, File Size: ${(r.file_size / 1024 / 1024).toFixed(2)} MB`);
  const manifestFile = path.join(r.directory, 'crawl-manifest.json');
  if (fs.existsSync(manifestFile)) {
    const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const totalDur = (new Date(m.completed_at) - new Date(m.started_at)) / 1000;
    console.log(`Total duration: ${totalDur}s`);
    for (const [stage, data] of Object.entries(m.stages || {})) {
      if (data.started_at && data.completed_at) {
        const dur = (new Date(data.completed_at) - new Date(data.started_at)) / 1000;
        console.log(`  ${stage}: ${dur}s (status: ${data.status})`);
      } else {
        console.log(`  ${stage}: status ${data.status}`);
      }
    }
  }
}
