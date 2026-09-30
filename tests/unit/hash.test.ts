import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { calculateFileSha256 } from '../../src/downloader/hash.js';

describe('SHA-256 Hasher', () => {
  const tmpFile = path.resolve(process.cwd(), './data/test_hash.txt');

  it('should compute exact SHA-256 hash of a file', async () => {
    const content = 'TikTok Standalone Crawler SHA256 Test 2026';
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
    fs.writeFileSync(tmpFile, content);

    const expectedHash = crypto.createHash('sha256').update(content).digest('hex');
    const actualHash = await calculateFileSha256(tmpFile);

    assert.equal(actualHash, expectedHash);

    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });
});
