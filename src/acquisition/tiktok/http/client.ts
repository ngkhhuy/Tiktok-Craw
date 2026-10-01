import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { RateLimiter } from '../../../utils/rate-limiter.js';
import { withRetry } from '../../../utils/retry.js';

export interface HttpClientOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  cookies?: string;
  timeoutMs?: number;
  isMobile?: boolean;
}

export interface HttpResponse<T = any> {
  status: number;
  statusText: string;
  headers: Headers;
  data: T;
  rawText: string;
  cookies: string;
}

export class TikTokHttpClient {
  private rateLimiter: RateLimiter;

  constructor(delayMs?: number) {
    this.rateLimiter = new RateLimiter(delayMs ?? config.requestDelayMs);
  }

  async get(url: string, options: HttpClientOptions = {}): Promise<HttpResponse> {
    return this.request(url, { ...options, method: 'GET' });
  }

  async request(url: string, options: HttpClientOptions = {}): Promise<HttpResponse> {
    await this.rateLimiter.acquire();

    const userAgent = options.isMobile ? config.userAgentMobile : config.userAgentDesktop;

    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options.headers || {}),
    };

    if (options.cookies) {
      headers['Cookie'] = options.cookies;
    }

    return await withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || config.requestTimeoutMs);

        try {
          const res = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body,
            signal: controller.signal,
          });

          // Capture Set-Cookie headers
          const rawCookies = (res.headers as any).getSetCookie
            ? (res.headers as any).getSetCookie().map((c: string) => c.split(';')[0]).join('; ')
            : res.headers.get('set-cookie') || '';

          const text = await res.text();
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {}

          return {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
            data: json,
            rawText: text,
            cookies: rawCookies,
          };
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxRetries: config.maxRetries,
        initialDelayMs: 1000,
        timeoutMs: (options.timeoutMs || config.requestTimeoutMs) + 2000,
        shouldRetry: (err) => {
          // Retry on network errors or 429/5xx if status available
          if (err.name === 'AbortError') return true;
          return true;
        },
      }
    );
  }
}

export const httpClient = new TikTokHttpClient();

// Comments can be paginated and slow. Keep their rate budget independent so
// a long comment queue never delays video/profile metadata acquisition.
export const commentsHttpClient = new TikTokHttpClient(config.commentRequestDelayMs);

// Separate client for media CDN downloads (thumbnail, images)
// with much lower rate limit since CDN servers are distributed and don't share rate limits with tiktok.com API
export const mediaHttpClient = new TikTokHttpClient(config.mediaRequestDelayMs);
