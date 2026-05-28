import pg from 'pg';
import { config } from './config.js';

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE task_status AS ENUM ('queued', 'parsing', 'completed', 'failed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        filename VARCHAR(512) NOT NULL,
        file_size BIGINT NOT NULL,
        file_sha256 CHAR(64) NOT NULL,
        mime_type VARCHAR(128) NOT NULL,
        status task_status NOT NULL DEFAULT 'queued',
        options JSONB DEFAULT '{}',
        markdown TEXT,
        total_pages INT,
        confidence REAL,
        error_message TEXT,
        file_ref_count INT DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        page_number INT NOT NULL,
        image_index INT NOT NULL,
        alt_text VARCHAR(512),
        file_path VARCHAR(1024) NOT NULL,
        width INT,
        height INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_sha256 ON tasks(file_sha256);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_images_task_id ON images(task_id);
    `);
    console.log('Database migration complete');
  } finally {
    client.release();
  }
}

export { pool as db };
