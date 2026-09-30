async function test() {
  const testUrl = 'https://www.tiktok.com/@tiktok/video/7106594312292453675';
  console.log('Testing direct HTML fetch for', testUrl);
  try {
    const res = await fetch(testUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    console.log('Status:', res.status);
    const html = await res.text();
    console.log('HTML length:', html.length);
    console.log('Has __UNIVERSAL_DATA_FOR_REHYDRATION__:', html.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__'));
    console.log('Has SIGI_STATE:', html.includes('SIGI_STATE'));
    console.log('Has __NEXT_DATA__:', html.includes('__NEXT_DATA__'));
    
    const uMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s);
    if (uMatch) {
      const data = JSON.parse(uMatch[1]);
      const defaultScope = data['__DEFAULT_SCOPE__'] || {};
      console.log('Universal default scope keys:', Object.keys(defaultScope));
      const itemDetail = defaultScope['webapp.video-detail'];
      if (itemDetail) {
        console.log('webapp.video-detail keys:', Object.keys(itemDetail));
        console.log('statusCode:', itemDetail.statusCode);
        console.log('itemInfo keys:', Object.keys(itemDetail.itemInfo || {}));
      }
    }
  } catch (err) {
    console.error('Direct fetch error:', err.message);
  }

  // Test TikWM public API as well
  try {
    console.log('\nTesting TikWM API...');
    const twmRes = await fetch('https://www.tikwm.com/api/?url=' + encodeURIComponent(testUrl));
    const twmData = await twmRes.json();
    console.log('TikWM status code:', twmData.code, 'msg:', twmData.msg);
    if (twmData.data) {
      console.log('TikWM data keys:', Object.keys(twmData.data));
      console.log('Video ID:', twmData.data.id);
      console.log('Title:', twmData.data.title);
      console.log('Author:', twmData.data.author);
      console.log('Play URL:', twmData.data.play ? 'found' : 'missing');
      console.log('Cover URL:', twmData.data.cover ? 'found' : 'missing');
      console.log('Stats:', {
        views: twmData.data.play_count,
        likes: twmData.data.digg_count,
        comments: twmData.data.comment_count,
        shares: twmData.data.share_count
      });
    }
  } catch (err) {
    console.error('TikWM error:', err.message);
  }

  // Test TikWM comments API
  try {
    console.log('\nTesting TikWM comments API...');
    const cRes = await fetch('https://www.tikwm.com/api/comment/list?url=' + encodeURIComponent(testUrl) + '&count=10');
    const cData = await cRes.json();
    console.log('TikWM comments status:', cData.code, 'total:', cData.data?.total, 'comments length:', cData.data?.comments?.length);
    if (cData.data?.comments?.length > 0) {
      console.log('First comment sample:', {
        id: cData.data.comments[0].id,
        text: cData.data.comments[0].text,
        user: cData.data.comments[0].user?.unique_id,
        reply_total: cData.data.comments[0].reply_comment_total
      });
    }
  } catch (err) {
    console.error('TikWM comments error:', err.message);
  }

  // Test yt-dlp dump json
  try {
    console.log('\nTesting yt-dlp metadata...');
    const { execSync } = await import('child_process');
    const out = execSync(`yt-dlp --dump-json --no-warnings "${testUrl}"`, { timeout: 30000, encoding: 'utf-8' });
    const ytdl = JSON.parse(out);
    console.log('yt-dlp video title:', ytdl.title);
    console.log('yt-dlp uploader:', ytdl.uploader);
    console.log('yt-dlp formats:', ytdl.formats?.length);
    console.log('yt-dlp duration:', ytdl.duration);
    console.log('yt-dlp view_count:', ytdl.view_count);
  } catch (err) {
    console.error('yt-dlp error:', err.message);
  }
}

test();
