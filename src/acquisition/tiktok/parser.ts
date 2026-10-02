import { ParsedTikTokUrl } from './types.js';

export function parseTikTokUrl(inputUrl: string): ParsedTikTokUrl {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { type: 'unknown', rawUrl: '' };
  }

  const trimmed = inputUrl.trim();

  // Support @username handle directly (e.g. @lap_trinh_vn)
  const handleMatch = trimmed.match(/^@([a-zA-Z0-9_.-]+)$/);
  if (handleMatch) {
    const username = handleMatch[1];
    return {
      type: 'profile',
      rawUrl: trimmed,
      canonicalUrl: `https://www.tiktok.com/@${username}`,
      username,
    };
  }

  let urlObj: URL;
  try {
    urlObj = new URL(trimmed);
  } catch {
    return { type: 'unknown', rawUrl: trimmed };
  }

  const hostname = urlObj.hostname.toLowerCase();
  const isTikTokHost =
    hostname === 'tiktok.com' ||
    hostname.endsWith('.tiktok.com');

  if (!isTikTokHost) {
    return { type: 'unknown', rawUrl: trimmed };
  }

  // Short URL domains
  if (
    hostname === 'vm.tiktok.com' ||
    hostname === 'vt.tiktok.com' ||
    (hostname.includes('tiktok.com') && urlObj.pathname.startsWith('/t/'))
  ) {
    return {
      type: 'short',
      rawUrl: trimmed,
    };
  }

  const pathname = urlObj.pathname;

  // Video URL match: /@username/video/123456789 or /@/video/123456789 or /video/123456789
  const videoMatch = pathname.match(/(?:^|\/)(?:@([^\/]*)\/)?video\/(\d+)/i);
  if (videoMatch) {
    const rawUser = videoMatch[1];
    const username = rawUser && rawUser.trim().length > 0 ? decodeURIComponent(rawUser) : undefined;
    const videoId = videoMatch[2];
    const canonical = username
      ? `https://www.tiktok.com/@${username}/video/${videoId}`
      : `https://www.tiktok.com/video/${videoId}`;

    return {
      type: 'video',
      rawUrl: trimmed,
      canonicalUrl: canonical,
      videoId,
      username,
    };
  }

  // Profile URL match: /@username or /@username/
  const profileMatch = pathname.match(/^\/@([^\/\?#]+)\/?$/i);
  if (profileMatch) {
    const username = decodeURIComponent(profileMatch[1]);
    return {
      type: 'profile',
      rawUrl: trimmed,
      canonicalUrl: `https://www.tiktok.com/@${username}`,
      username,
    };
  }

  return {
    type: 'unknown',
    rawUrl: trimmed,
  };
}

export function buildCanonicalVideoUrl(username: string, videoId: string): string {
  const cleanUser = username.startsWith('@') ? username.slice(1) : username;
  return `https://www.tiktok.com/@${cleanUser}/video/${videoId}`;
}

export function buildCanonicalProfileUrl(username: string): string {
  const cleanUser = username.startsWith('@') ? username.slice(1) : username;
  return `https://www.tiktok.com/@${cleanUser}`;
}
