export type TikTokUrlType = 'video' | 'profile' | 'short' | 'unknown';

export interface ParsedTikTokUrl {
  type: TikTokUrlType;
  rawUrl: string;
  canonicalUrl?: string;
  videoId?: string;
  username?: string;
}

export interface TikTokAuthor {
  id: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface TikTokMusic {
  id: string | null;
  title: string | null;
  author: string | null;
}

export interface TikTokContent {
  description: string;
  hashtags: string[];
  mentions: string[];
  music: TikTokMusic | null;
}

export interface TikTokEngagement {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

export interface TikTokMediaInfo {
  video_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  is_photo_mode?: boolean;
  images?: string[];
  music_url?: string | null;
}

export interface NormalizedTikTokVideo {
  source: 'tiktok';
  video_id: string;
  url: string;
  canonical_url: string;
  author: TikTokAuthor;
  content: TikTokContent;
  engagement: TikTokEngagement;
  published_at: string | null;
  media: TikTokMediaInfo;
  platform_specific: Record<string, any>;
  cookies?: string; // Captured session cookies for media download
}

export interface TikTokCommentAuthor {
  id: string | null;
  username: string;
  display_name: string | null;
  avatar_url?: string | null;
}

export interface NormalizedTikTokComment {
  comment_id: string;
  video_id: string;
  parent_comment_id: string | null;
  author: TikTokCommentAuthor;
  text: string;
  like_count: number;
  published_at: string | null;
  is_reply: boolean;
}

export interface CommentFetchResult {
  status: 'completed' | 'unavailable' | 'failed';
  comments: NormalizedTikTokComment[];
  total?: number;
  reason?: string;
}

export interface TikTokProfileStats {
  followers: number;
  following: number;
  likes: number;
  videos: number;
}

export interface NormalizedTikTokProfile {
  platform: 'tiktok';
  profile_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_url: string;
  bio: string | null;
  stats: TikTokProfileStats;
  platform_specific: Record<string, any>;
  sec_uid?: string;
}

export interface DiscoveredVideoReference {
  video_id: string;
  url: string;
  published_at?: string | null;
  description?: string | null;
  normalized?: NormalizedTikTokVideo;
}

export interface ProfileDiscoveryResult {
  profile_id: string;
  username: string;
  fetched_at: string;
  total_discovered: number;
  videos: DiscoveredVideoReference[];
  pagination_state?: {
    cursor?: string | number;
    has_more?: boolean;
    pages_fetched?: number;
  };
  method: 'http' | 'browser_fallback';
  limitation?: string;
}
