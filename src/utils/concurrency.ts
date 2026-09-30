export class ConcurrencyLimiter {
  private concurrency: number;
  private activeCount: number = 0;
  private queue: Array<() => void> = [];

  constructor(concurrency: number = 2) {
    this.concurrency = Math.max(1, concurrency);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.concurrency) {
      await new Promise<void>(resolve => {
        this.queue.push(resolve);
      });
    }

    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }

  get active(): number {
    return this.activeCount;
  }

  get pending(): number {
    return this.queue.length;
  }
}
