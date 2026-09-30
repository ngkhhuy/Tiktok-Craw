import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  timeoutMs?: number;
  shouldRetry?: (error: any) => boolean;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName = 'Operation'): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 5000,
    factor = 2,
    jitter = true,
    timeoutMs,
    shouldRetry = () => true
  } = options;

  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      if (timeoutMs) {
        return await withTimeout(operation(attempt), timeoutMs, `Attempt ${attempt}`);
      }
      return await operation(attempt);
    } catch (err: any) {
      if (attempt > maxRetries || !shouldRetry(err)) {
        throw err;
      }

      // Calculate jittered delay
      const jitterAmount = jitter ? Math.random() * 0.5 * delay : 0;
      const actualDelay = Math.min(delay + jitterAmount, maxDelayMs);

      logger.debug(`Retry attempt ${attempt}/${maxRetries} after ${Math.round(actualDelay)}ms due to: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, actualDelay));

      delay = Math.min(delay * factor, maxDelayMs);
    }
  }

  throw new Error('Retry exhausted');
}
