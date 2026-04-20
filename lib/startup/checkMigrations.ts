import fs from 'node:fs/promises'
import path from 'node:path'

import { db } from '@/config/db'

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations')
const MIGRATION_FILE_RE = /\.(cjs|mjs|js|ts)$/

export type MigrationCheckResult = {
  status: 'ok' | 'drift' | 'skipped' | 'error'
  onDisk: number
  applied: number
  pending: string[]
  message?: string
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR)
  return entries.filter((f) => MIGRATION_FILE_RE.test(f) && !f.startsWith('.')).sort()
}

async function listAppliedMigrations(): Promise<Set<string>> {
  const rows = await db('knex_migrations').select<{ name: string }[]>('name')
  return new Set(rows.map((r) => r.name))
}

export async function checkPendingMigrations(): Promise<MigrationCheckResult> {
  let onDiskFiles: string[]
  try {
    onDiskFiles = await listMigrationFiles()
  } catch (err) {
    return {
      status: 'skipped',
      onDisk: 0,
      applied: 0,
      pending: [],
      message: `Could not read ${MIGRATIONS_DIR}: ${(err as Error).message}`,
    }
  }

  let applied: Set<string>
  try {
    applied = await listAppliedMigrations()
  } catch (err) {
    return {
      status: 'error',
      onDisk: onDiskFiles.length,
      applied: 0,
      pending: [],
      message: `Could not query knex_migrations: ${(err as Error).message}`,
    }
  }

  const pending = onDiskFiles.filter((f) => !applied.has(f))

  return {
    status: pending.length === 0 ? 'ok' : 'drift',
    onDisk: onDiskFiles.length,
    applied: applied.size,
    pending,
  }
}

function formatDriftBanner(res: MigrationCheckResult): string {
  const lines = [
    '',
    '==================================================================',
    'Missing migrations detected in production',
    '==================================================================',
    `  on disk: ${res.onDisk}`,
    `  applied: ${res.applied}`,
    `  pending: ${res.pending.length}`,
    '',
    '  pending files:',
    ...res.pending.map((p) => `    - ${p}`),
    '',
    '  Run `npx knex --knexfile knexfile.cjs migrate:latest`',
    '  against the production database to apply them.',
    '  This check does NOT auto-apply migrations.',
    '==================================================================',
    '',
  ]
  return lines.join('\n')
}

export async function assertMigrationsUpToDate(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production'
  const strict = process.env.STRICT_MIGRATIONS === '1'

  let res: MigrationCheckResult
  try {
    res = await checkPendingMigrations()
  } catch (err) {
    console.error('[migrations] startup check crashed:', err)
    return
  }

  switch (res.status) {
    case 'ok':
      console.info(`[migrations] up to date (${res.applied}/${res.onDisk} applied)`)
      return

    case 'skipped':
      console.warn(`[migrations] startup check skipped: ${res.message}`)
      return

    case 'error':
      console.error(`[migrations] startup check failed: ${res.message}`)
      return

    case 'drift': {
      const banner = formatDriftBanner(res)
      if (isProd) console.error(banner)
      else console.warn(banner)

      if (isProd && strict) {
        throw new Error(
          `Missing migrations in production: ${res.pending.length} pending (${res.pending.join(', ')})`,
        )
      }
      return
    }
  }
}
