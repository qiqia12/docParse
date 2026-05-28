import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from '../../src/services/file-store.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileStore', () => {
  let store: FileStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docparse-test-'));
    store = new FileStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves file and returns sha256', async () => {
    const content = Buffer.from('hello world');
    const hash = await store.save(content);
    expect(hash).toBe(store.sha256(content));
    expect(await store.exists(hash)).toBe(true);
  });

  it('deduplicates by sha256', async () => {
    const content = Buffer.from('same content');
    const hash1 = await store.save(content);
    const hash2 = await store.save(content);
    expect(hash1).toBe(hash2);
  });

  it('deletes file', async () => {
    const content = Buffer.from('temporary');
    const hash = await store.save(content);
    await store.delete(hash);
    expect(await store.exists(hash)).toBe(false);
  });
});
