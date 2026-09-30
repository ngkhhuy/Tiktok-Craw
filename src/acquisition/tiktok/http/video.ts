import { httpClient } from './client.js';
import { NormalizedTikTokVideo } from '../types.js';
import { buildCanonicalVideoUrl } from '../parser.js';
import { logger } from '../../../utils/logger.js';

export function extractRehydrationData(html: string): any | null {
  // 1. Try __UNIVERSAL_DATA_FOR_REHYDRATION__
  const universalMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (universalMatch) {
    try {
      return JSON.parse(universalMatch[1]);
    } catch {}
  }

  // 2. Try SIGI_STATE
  const sigiMatch = html.match(/<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  if (sigiMatch) {
    try {
      return JSON.parse(sigiMatch[1]);
    } catch {}
  }

  // 3. Try __NEXT_DATA__
  const nextMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      return JSON.parse(nextMatch[1]);
    } catch {}
  }

  return null;
}

export function normalizeVideoMetadata(
  itemStruct: any,
  rawUrl: string,
  cookies?: string
): NormalizedTikTokVideo {
  const videoId = String(itemStruct.id || '');
  const username = itemStruct.author?.uniqueId || '';
  const canonicalUrl = username ? buildCanonicalVideoUrl(username, videoId) : rawUrl;

  // Extract hashtags from text or challenges
  const hashtags: string[] = [];
  if (Array.isArray(itemStruct.challenges)) {
    for (const c of itemStruct.challenges) {
      if (c.title) hashtags.push(c.title);
    }
  }
  // Also regex match hashtags in desc if none found
  if (hashtags.length === 0 && itemStruct.desc) {
    const matches = itemStruct.desc.match(/#([\w\u0080-\uffff]+)/g);
    if (matches) {
      hashtags.push(...matches.map((h: string) => h.slice(1)));
    }
  }

  // Mentions
  const mentions: string[] = [];
  if (Array.isArray(itemStruct.textExtra)) {
    for (const t of itemStruct.textExtra) {
      if (t.userUniqueId) mentions.push(t.userUniqueId);
    }
  }

  // Music
  const music = itemStruct.music
    ? {
        id: itemStruct.music.id ? String(itemStruct.music.id) : null,
        title: itemStruct.music.title || null,
        author: itemStruct.music.authorName || null,
      }
    : null;

  // Published at
  let publishedAt: string | null = null;
  if (itemStruct.createTime) {
    try {
      publishedAt = new Date(Number(itemStruct.createTime) * 1000).toISOString();
    } catch {}
  }

  // Media
  const videoObj = itemStruct.video || {};
  const videoUrl = videoObj.playAddr || videoObj.downloadAddr || null;
  const thumbnailUrl = videoObj.cover || videoObj.originCover || videoObj.dynamicCover || null;

  // Photo Mode (Slideshow / Image Carousel) Detection
  const imagePost = itemStruct.imagePost || itemStruct.image_post_info;
  const isPhotoMode = Boolean(imagePost && Array.isArray(imagePost.images) && imagePost.images.length > 0);
  const photoImages: string[] = [];
  if (isPhotoMode) {
    for (const img of imagePost.images) {
      const u = img.imageURL?.urlList?.[0] || img.imageURL?.urlList?.[1] || img.display_image?.url_list?.[0];
      if (u) photoImages.push(u);
    }
  }

  const musicUrl = itemStruct.music?.playUrl || itemStruct.music?.play_url || null;

  return {
    source: 'tiktok',
    video_id: videoId,
    url: rawUrl,
    canonical_url: canonicalUrl,
    author: {
      id: itemStruct.author?.id ? String(itemStruct.author.id) : null,
      username: username,
      display_name: itemStruct.author?.nickname || null,
      avatar_url: itemStruct.author?.avatarLarger || itemStruct.author?.avatarMedium || itemStruct.author?.avatarThumb || null,
    },
    content: {
      description: itemStruct.desc || '',
      hashtags: [...new Set(hashtags)],
      mentions: [...new Set(mentions)],
      music,
    },
    engagement: {
      views: Number(itemStruct.stats?.playCount || 0),
      likes: Number(itemStruct.stats?.diggCount || 0),
      comments: Number(itemStruct.stats?.commentCount || 0),
      shares: Number(itemStruct.stats?.shareCount || 0),
      saves: Number(itemStruct.stats?.collectCount || 0),
    },
    published_at: publishedAt,
    media: {
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      duration: videoObj.duration ? Number(videoObj.duration) : null,
      width: videoObj.width ? Number(videoObj.width) : null,
      height: videoObj.height ? Number(videoObj.height) : null,
      is_photo_mode: isPhotoMode,
      images: photoImages,
      music_url: musicUrl,
    },
    platform_specific: itemStruct,
    cookies,
  };
}

export async function fetchVideoMetadataHttp(
  videoUrl: string
): Promise<NormalizedTikTokVideo> {
  logger.stage('metadata', `Fetching video metadata for: ${videoUrl}`);

  let res = await httpClient.get(videoUrl);

  if (res.status !== 200) {
    throw new Error(`Failed to fetch video page: HTTP ${res.status} ${res.statusText}`);
  }

  let rehydration = extractRehydrationData(res.rawText);

  // If WAF challenge or rehydration missing, retry with mobile UA
  if (!rehydration || res.rawText.includes('SlardarWAF')) {
    logger.debug('Retrying video fetch with mobile user agent to bypass web WAF challenge');
    res = await httpClient.get(videoUrl, { isMobile: true });
    rehydration = extractRehydrationData(res.rawText);
  }
  if (!rehydration) {
    logger.warn(`Video page HTML length: ${res.rawText.length}, preview: ${res.rawText.slice(0, 300)}`);
    throw new Error(`Could not find rehydration data (__UNIVERSAL_DATA_FOR_REHYDRATION__) in video HTML (len: ${res.rawText.length})`);
  }

  const defaultScope = rehydration['__DEFAULT_SCOPE__'] || {};
  const videoDetail = defaultScope['webapp.video-detail'];

  if (!videoDetail || !videoDetail.itemInfo?.itemStruct) {
    // Check if SIGI_STATE format
    const itemModule = rehydration.ItemModule;
    if (itemModule) {
      const firstId = Object.keys(itemModule)[0];
      if (firstId && itemModule[firstId]) {
        return normalizeVideoMetadata(itemModule[firstId], videoUrl, res.cookies);
      }
    }
    throw new Error('Video itemStruct not found in TikTok rehydration data');
  }

  const itemStruct = videoDetail.itemInfo.itemStruct;
  const normalized = normalizeVideoMetadata(itemStruct, videoUrl, res.cookies);
  logger.stage('metadata', `Normalized metadata for video ${normalized.video_id} by @${normalized.author.username}`);

  return normalized;
}
