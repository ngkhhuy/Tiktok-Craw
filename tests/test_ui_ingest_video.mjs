import { chromium } from 'playwright';

async function testUiIngestVideo() {
  console.log('Launching browser for video test...');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  const input = page.locator('#ingestInput');
  await input.waitFor({ state: 'visible', timeout: 5000 });

  const videoUrl = 'https://www.tiktok.com/@nguyenhung.1201/video/7576905668821634312';
  console.log('Typing video link and pressing Enter...');
  await input.fill(videoUrl);
  await input.press('Enter');

  // Verify crawl progress card appears
  const progressCard = page.locator('#crawlProgressCard');
  await progressCard.waitFor({ state: 'visible', timeout: 10000 });
  console.log('Crawl Progress Card is visible for video!');

  // Check progress text
  const statusText = await page.locator('#progressStatusText').textContent();
  console.log('Progress Status Text:', statusText);

  // Take screenshot
  await page.screenshot({ path: 'tests/ui_video_ingest_screenshot.png' });
  console.log('Video ingest screenshot saved to tests/ui_video_ingest_screenshot.png');

  await browser.close();
}

testUiIngestVideo().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
