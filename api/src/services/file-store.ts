import { createHash } from 'crypto';
import { writeFile, mkdir, unlink, access } from 'fs/promises';
import { join } from 'path';

const FILES_DIR = process.env.FILES_DIR || '/tmp/docparse/files';

export class FileStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || FILES_DIR;
  }

  sha256(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  getPath(sha256: string): string {
    const prefix = sha256.slice(0, 2);
    return join(this.baseDir, prefix, sha256);
  }

  async save(content: Buffer): Promise<string> {
    const hash = this.sha256(content);
    const filePath = this.getPath(hash);
    const dir = join(this.baseDir, hash.slice(0, 2));
    await mkdir(dir, { recursive: true });
    try {
      await access(filePath);
    } catch {
      await writeFile(filePath, content);
    }
    return hash;
  }

  async delete(sha256: string): Promise<void> {
    try {
      await unlink(this.getPath(sha256));
    } catch {
      // file may not exist, ignore
    }
  }

  async exists(sha256: string): Promise<boolean> {
    try {
      await access(this.getPath(sha256));
      return true;
    } catch {
      return false;
    }
  }
}

export const fileStore = new FileStore();
