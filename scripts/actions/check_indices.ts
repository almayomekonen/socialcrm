import { db } from '@/config/db'

async function checkIndexUsage() {
  try {
    const result = await db.raw(`
      SELECT
        schemaname || '.' || relname AS "table",
        indexrelname AS "index",
        idx_scan as "times_used",
        pg_size_pretty(pg_relation_size(indexrelid)) AS "index_size"
      FROM pg_stat_user_indexes
      WHERE indexrelname LIKE 'idx_%'
      ORDER BY idx_scan DESC;
    `)

    console.table(result.rows)
  } catch (error) {
    console.error('Error checking index usage:', error)
  } finally {
    await db.destroy()
  }
}

checkIndexUsage()
