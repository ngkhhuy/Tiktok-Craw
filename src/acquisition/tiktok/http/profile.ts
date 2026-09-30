import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { httpClient } from './client.js';
import {
  NormalizedTikTokProfile,
  ProfileDiscoveryResult,
  DiscoveredVideoReference,
} from '../types.js';
import { extractRehydrationData } from './video.js';

export function normalizeProfileData(rawUserDetail: any, username: string): NormalizedTikTokProfile {
  const userInfo = rawUserDetail?.userInfo || {};
  const user = userInfo.user || {};
  const stats = userInfo.stats || {};

  const profileId = String(user.id || username);
  const uniqueId = user.uniqueId || username;
  const canonicalUrl = `https://www.tiktok.com/@${uniqueId}`;

  return {
    platform: 'tiktok',
    profile_id: profileId,
    username: uniqueId,
    sec_uid: user.secUid,
    display_name: user.nickname || null,
    avatar_url: user.avatarLarger || user.avatarMedium || user.avatarThumb || null,
    profile_url: canonicalUrl,
    bio: user.signature || null,
    stats: {
      followers: Number(stats.followerCount || 0),
      following: Number(stats.followingCount || 0),
      likes: Number(stats.heartCount || stats.heart || 0),
      videos: Number(stats.videoCount || 0),
    },
    platform_specific: userInfo,
  };
}

export async function resolveProfileHttp(username: string): Promise<NormalizedTikTokProfile> {
  const cleanUsername = username.startsWith('@') ? username.slice(1) : username;
  const profileUrl = `https://www.tiktok.com/@${cleanUsername}`;

  logger.stage('profile', `Resolving profile: @${cleanUsername}`);

  // Fetch with mobile UA to get clean SSR rehydration data without bot challenge
  const res = await httpClient.get(profileUrl, { isMobile: true });

  if (res.status !== 200) {
    throw new Error(`Failed to resolve profile @${cleanUsername}: HTTP ${res.status}`);
  }

  const rehydration = extractRehydrationData(res.rawText);
  if (!rehydration) {
    throw new Error(`Rehydration data not found in profile page for @${cleanUsername}`);
  }

  const defaultScope = rehydration['__DEFAULT_SCOPE__'] || {};
  const userDetail = defaultScope['webapp.user-detail'];

  if (!userDetail || !userDetail.userInfo) {
    throw new Error(`User detail not found in TikTok profile data for @${cleanUsername}`);
  }

  const normalized = normalizeProfileData(userDetail, cleanUsername);
  logger.stage('profile', `Resolved profile @${normalized.username} (ID: ${normalized.profile_id}, Followers: ${normalized.stats.followers.toLocaleString()})`);

  return normalized;
}

export async function discoverProfileVideosHttp(
  profile: NormalizedTikTokProfile,
  limit: number = 20
): Promise<ProfileDiscoveryResult> {
  logger.stage('discover', `Attempting HTTP discovery for @${profile.username} (limit: ${limit})`);

  const profileUrl = profile.profile_url;
  const res = await httpClient.get(profileUrl, { isMobile: true });
  const videos: DiscoveredVideoReference[] = [];
  const seenVideoIds = new Set<string>();

  if (res.status === 200) {
    const rehydration = extractRehydrationData(res.rawText);
    if (rehydration) {
      const defaultScope = rehydration['__DEFAULT_SCOPE__'] || {};
      const postList = defaultScope['webapp.user-post-list'];
      if (postList && Array.isArray(postList.itemList)) {
        for (const item of postList.itemList) {
          if (videos.length >= limit) break;
          const author = (item.author?.uniqueId || item.author?.unique_id || '').toLowerCase();
          if (author && author !== profile.username.toLowerCase()) continue;
          const vId = String(item.id || item.video_id);
          if (vId && !seenVideoIds.has(vId)) {
            seenVideoIds.add(vId);
            videos.push({
              video_id: vId,
              url: `https://www.tiktok.com/@${profile.username}/video/${vId}`,
              published_at: item.createTime ? new Date(Number(item.createTime) * 1000).toISOString() : null,
              description: item.desc || null,
            });
          }
        }
      }
    }

    // Also parse any video links found in raw HTML specifically belonging to this user
    const userVideoRegex = new RegExp(`/@${profile.username}/video/(\\d{15,22})`, 'gi');
    const videoMatches = [...res.rawText.matchAll(userVideoRegex)];
    for (const match of videoMatches) {
      if (videos.length >= limit) break;
      const vId = match[1];
      if (!seenVideoIds.has(vId)) {
        seenVideoIds.add(vId);
        videos.push({
          video_id: vId,
          url: `https://www.tiktok.com/@${profile.username}/video/${vId}`,
        });
      }
    }
  }

  logger.stage('discover', `HTTP discovery found ${videos.length} videos for @${profile.username}`);

  return {
    profile_id: profile.profile_id,
    username: profile.username,
    fetched_at: new Date().toISOString(),
    total_discovered: videos.length,
    videos,
    method: 'http',
  };
}
