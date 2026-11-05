/**
 * REPORT ONLY: counts R2 objects no database row points at. It deletes nothing and has
 * no option to, and prints no keys, since acting on them is a separate decision.
 *
 *   npx tsx --conditions=react-server scripts/r2-orphan-report.ts
 *
 * Needs the R2_* variables and DATABASE_URL of the environment being checked.
 */
import { db } from '../config/db'
import { listObjects } from '../lib/storage/objects'
import { findOrphans, type StoredObject } from '../lib/storage/orphans'

async function run() {
  const objects: StoredObject[] = []
  let cursor: string | undefined
  do {
    const page = await listObjects({ prefix: 'tenants/', cursor })
    objects.push(...page.objects)
    cursor = page.nextCursor
  } while (cursor)

  const [files, documents] = await Promise.all([
    db('files').where('path', 'like', 'tenants/%').select('path'),
    db('bill_documents').where('path', 'like', 'tenants/%').select('path'),
  ])
  const referenced = new Set<string>([...files, ...documents].map((r: { path: string }) => r.path))
  const orphans = findOrphans(objects, referenced, Date.now())
  const bytes = orphans.reduce((sum, o) => sum + o.size, 0)
  console.log(JSON.stringify({ objects: objects.length, referenced: referenced.size, orphans: orphans.length, orphanBytes: bytes }))
}

run()
  .catch((err) => {
    console.error('orphan report failed:', (err as Error)?.name ?? 'error')
    process.exitCode = 1
  })
  .finally(() => db.destroy())
