export class RateLimiter {
  private delayMs: number;
  private lastRequestTime: number = 0;

  constructor(delayMs: number = 500) {
    this.delayMs = delayMs;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.delayMs) {
      const waitTime = this.delayMs - timeSinceLast;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();
  }

  setDelay(delayMs: number): void {
    this.delayMs = delayMs;
  }
}
