/**
 * Sprint 0 — one-off backfill of whatsapp_connections.waba_id.
 *
 * For every connection missing a waba_id, resolve the owning WABA from the
 * stored Cloud API token (debug_token granular scopes) and persist it.
 *
 * Idempotent by construction: only rows with a null waba_id are scanned, and
 * setConnectionWabaId re-checks `whereNull` — re-running is always safe.
 *
 * config/db is pinned to the local env, so this script builds its OWN knex
 * client from the target env file (default .env.local; pass --prod for
 * .env.production.local) rather than importing the app singleton.
 *
 * Usage:
 *   tsx scripts/backfill_waba_id.ts            # local, writes
 *   tsx scripts/backfill_waba_id.ts --prod --dry-run
 *   tsx scripts/backfill_waba_id.ts --prod     # production, writes
 */
import fs from 'fs'
import knexLib, { type Knex } from 'knex'
import { resolveWabaForPhone } from '../lib/whatsapp/resolveWaba'
import { listConnectionsMissingWaba, setConnectionWabaId } from '../db/whatsapp'

export type BackfillDeps = {
  list: () => Promise<{ id: number; phone_number_id: string; access_token: string }[]>
  resolve: (token: string, phoneNumberId: string) => Promise<string | null>
  set: (id: number, wabaId: string) => Promise<number>
  log?: (msg: string) => void
}

export type BackfillResult = { scanned: number; set: number; unresolved: number }

/**
 * Pure orchestration — no I/O of its own, fully unit-testable with injected deps.
 */
export async function runWabaBackfill(deps: BackfillDeps, opts: { dryRun?: boolean } = {}): Promise<BackfillResult> {
  const log = deps.log ?? (() => {})
  const rows = await deps.list()
  log(`[backfill_waba] ${rows.length} connection(s) missing waba_id${opts.dryRun ? ' (dry run)' : ''}`)

  let set = 0
  let unresolved = 0
  for (const row of rows) {
    const wabaId = await deps.resolve(row.access_token, row.phone_number_id)
    if (!wabaId) {
      log(`[backfill_waba] unresolved: phone_number_id=${row.phone_number_id} (id=${row.id})`)
      unresolved++
      continue
    }
    if (opts.dryRun) {
      log(`[backfill_waba] would set id=${row.id} -> waba_id=${wabaId}`)
      continue
    }
    const updated = await deps.set(row.id, wabaId)
    if (updated > 0) {
      log(`[backfill_waba] set id=${row.id} -> waba_id=${wabaId}`)
      set++
    }
  }

  log(`[backfill_waba] done. scanned=${rows.length} set=${set} unresolved=${unresolved}`)
  return { scanned: rows.length, set, unresolved }
}

function readEnv(file: string, key: string): string | undefined {
  try {
    const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]+)`, 'm'))
    return m?.[1]?.trim()
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const envFile = process.argv.includes('--prod') ? '.env.production.local' : '.env.local'

  const rawUrl = readEnv(envFile, 'DATABASE_URL')
  const appId = readEnv(envFile, 'META_APP_ID')
  const appSecret = readEnv(envFile, 'META_APP_SECRET')
  if (!rawUrl) {
    console.error(`[backfill_waba] no DATABASE_URL in ${envFile}`)
    process.exit(1)
  }

  const url = new URL(rawUrl)
  const sslMode = url.searchParams.get('sslmode')
  url.searchParams.delete('sslmode')
  url.searchParams.delete('channel_binding')
  const useSSL = ['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')
  console.log(`[backfill_waba] target ${url.host}${url.pathname}${dryRun ? ' (dry run)' : ''}`)

  const conn: Knex = knexLib({
    client: 'pg',
    connection: { connectionString: url.toString(), ssl: useSSL ? { rejectUnauthorized: false } : false },
    pool: { min: 0, max: 4 },
  })

  try {
    await runWabaBackfill(
      {
        list: () => listConnectionsMissingWaba(conn),
        resolve: (token, phone) => resolveWabaForPhone(token, phone, appId, appSecret),
        set: (id, wabaId) => setConnectionWabaId(id, wabaId, conn),
        log: (m) => console.log(m),
      },
      { dryRun },
    )
  } finally {
    await conn.destroy()
  }
}

// Run only when executed directly (never when imported by a test).
const entry = process.argv[1] ?? ''
if (/backfill_waba_id\.(ts|js)$/.test(entry)) {
  main().catch((e) => {
    console.error('[backfill_waba] failed', e)
    process.exit(1)
  })
}
