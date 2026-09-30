import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConcurrencyLimiter } from '../../src/utils/concurrency.js';

describe('ConcurrencyLimiter', () => {
  it('should limit parallel executions to specified concurrency', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let maxRunning = 0;
    let currentlyRunning = 0;

    const task = async (id: number) => {
      return limiter.run(async () => {
        currentlyRunning++;
        if (currentlyRunning > maxRunning) {
          maxRunning = currentlyRunning;
        }
        await new Promise(r => setTimeout(r, 50));
        currentlyRunning--;
        return id;
      });
    };

    const results = await Promise.all([task(1), task(2), task(3), task(4), task(5)]);

    assert.equal(maxRunning, 2);
    assert.deepEqual(results, [1, 2, 3, 4, 5]);
  });
});
