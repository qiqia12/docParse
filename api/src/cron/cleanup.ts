import cron from 'node-cron';
import { db } from '../db.js';
import { fileStore } from '../services/file-store.js';
import { config } from '../config.js';

export function startCleanupCron() {
  cron.schedule('0 */6 * * *', async () => {
    console.log('Running cleanup cron...');
    try {
      const cutoff = new Date(Date.now() - config.FILE_RETENTION_HOURS * 3600 * 1000);
      const { rows } = await db.query(
        `SELECT id, file_sha256, file_ref_count FROM tasks WHERE status = 'completed' AND created_at < $1`,
        [cutoff]
      );
      for (const task of rows) {
        if (task.file_ref_count <= 1) {
          await fileStore.delete(task.file_sha256);
          await db.query(`DELETE FROM tasks WHERE id = $1`, [task.id]);
        } else {
          await db.query(`UPDATE tasks SET file_ref_count = file_ref_count - 1 WHERE id = $1`, [task.id]);
        }
      }
      console.log(`Cleaned up ${rows.length} expired tasks`);
    } catch (err) {
      console.error('Cleanup cron error:', err);
    }
  });
}
