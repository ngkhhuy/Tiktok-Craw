export class RateLimiter {
  private delayMs: number;
  private nextAvailableAt: number = 0;

  constructor(delayMs: number = 500) {
    this.delayMs = Math.max(0, delayMs);
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    // Reserve a distinct slot synchronously before awaiting. This prevents a
    // group of concurrent callers from all waking up and sending a burst at
    // the same instant.
    const scheduledAt = Math.max(now, this.nextAvailableAt);
    this.nextAvailableAt = scheduledAt + this.delayMs;
    const waitTime = scheduledAt - now;
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  setDelay(delayMs: number): void {
    this.delayMs = Math.max(0, delayMs);
  }
}
