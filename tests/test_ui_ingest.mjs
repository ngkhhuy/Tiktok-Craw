import { chromium } from 'playwright';

async function testUiIngest() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // Verify ingest input is visible
  const input = page.locator('#ingestInput');
  await input.waitFor({ state: 'visible', timeout: 5000 });
  console.log('Ingest input found.');

  // Type profile and press Enter
  console.log('Typing @nguyenhung.1201 and hitting Enter...');
  await input.fill('@nguyenhung.1201');
  await input.press('Enter');

  // Wait for profile hero card
  const heroCard = page.locator('#profileHeroCard');
  await heroCard.waitFor({ state: 'visible', timeout: 10000 });
  console.log('Profile Hero Card is visible!');

  // Wait until followers text is populated with actual value
  await page.waitForFunction(() => {
    const el = document.getElementById('profFollowers');
    return el && el.textContent.trim() !== '0';
  }, { timeout: 15000 });

  // Extract the 4 priority statistics
  const followers = await page.locator('#profFollowers').textContent();
  const views = await page.locator('#profViews').textContent();
  const likes = await page.locator('#profLikes').textContent();
  const videos = await page.locator('#profVideos').textContent();
  const displayName = await page.locator('#profDisplayName').textContent();

  console.log('--- EXTRACTED PROFILE STATS ---');
  console.log('Display Name:', displayName);
  console.log('1. Số Follower:', followers);
  console.log('2. Tổng lượt View:', views);
  console.log('3. Tổng lượt Like:', likes);
  console.log('4. Tổng số Video đã đăng:', videos);

  // Take screenshot immediately while displaying the full card and stats
  await page.screenshot({ path: 'tests/ui_profile_stats_screenshot.png' });
  console.log('Screenshot saved to tests/ui_profile_stats_screenshot.png');

  // Stop crawl if button is active
  const stopBtn = page.locator('#btnStopCrawl');
  if (await stopBtn.isVisible() && await stopBtn.isEnabled()) {
    await stopBtn.click();
    console.log('Clicked stop crawl button.');
  }

  await browser.close();
}

testUiIngest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
