export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'unavailable';

export interface StageInfo {
  status: StageStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
  count?: number;
}

export interface VideoManifest {
  source: 'tiktok';
  video_id: string;
  url: string;
  started_at: string;
  completed_at?: string;
  status: 'completed' | 'failed' | 'running' | 'pending';
  stages: {
    metadata: StageInfo;
    video: StageInfo;
    thumbnail: StageInfo;
    technical: StageInfo;
    comments: StageInfo;
    hash: StageInfo;
  };
  files: {
    video?: string;
    thumbnail?: string;
    metadata?: string;
    technical?: string;
    comments?: string;
  };
  hash?: {
    algorithm: 'sha256';
    value: string;
  };
  error?: {
    code?: string;
    message: string;
    stage?: string;
  };
}

export interface ProfileCrawlManifest {
  platform: 'tiktok';
  profile_id: string;
  username: string;
  profile_url: string;
  started_at: string;
  updated_at: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  stats: {
    discovered: number;
    completed: number;
    skipped: number;
    failed: number;
    pending: number;
  };
  videos: Record<
    string,
    {
      status: StageStatus;
      attempts: number;
      started_at?: string;
      completed_at?: string;
      error?: string;
    }
  >;
}
