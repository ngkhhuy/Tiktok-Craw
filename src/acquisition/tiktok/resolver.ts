import { parseTikTokUrl } from './parser.js';
import { ParsedTikTokUrl } from './types.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retry.js';

export async function resolveTikTokUrl(inputUrl: string): Promise<ParsedTikTokUrl> {
  const initial = parseTikTokUrl(inputUrl);

  if (initial.type !== 'short') {
    return initial;
  }

  logger.stage('resolve', `Resolving short URL: ${inputUrl}`);

  return await withRetry(
    async () => {
      let currentUrl = inputUrl;
      const maxHops = 5;
      let hops = 0;

      while (hops < maxHops) {
        const res = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': config.userAgentDesktop,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        const status = res.status;
        const location = res.headers.get('location');

        if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && location) {
          currentUrl = new URL(location, currentUrl).toString();
          hops++;
          const parsed = parseTikTokUrl(currentUrl);
          if (parsed.type === 'video' || parsed.type === 'profile') {
            logger.stage('resolve', `Resolved ${inputUrl} → ${parsed.canonicalUrl || currentUrl}`);
            return parsed;
          }
        } else {
          // If not redirecting or landed on 200, check the final URL
          const parsed = parseTikTokUrl(currentUrl);
          return parsed;
        }
      }

      return parseTikTokUrl(currentUrl);
    },
    {
      maxRetries: 2,
      initialDelayMs: 300,
      timeoutMs: 15000,
    }
  );
}
