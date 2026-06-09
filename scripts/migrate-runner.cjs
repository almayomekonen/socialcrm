// One-off migration workflow helper (NOT a migration file).
// Runs knex status/latest/verification against local or production env.
//
// Usage: node scripts/migrate-runner.cjs <local|production> <status|latest|verify|counts>
//
// - Reuses the SAME ssl handling as config/db.ts (sslmode-aware).
// - For Neon production, migrations use the DIRECT endpoint (strips "-pooler")
//   because DDL / CREATE INDEX CONCURRENTLY should not run through PgBouncer.
// - Never prints credentials.
const path = require('path')

const TARGET = process.argv[2]
const CMD = process.argv[3] ?? 'status'
if (!['local', 'production'].includes(TARGET)) {
  console.error('Usage: node scripts/migrate-runner.cjs <local|production> <status|latest|verify|counts>')
  process.exit(1)
}

const envFile = TARGET === 'production' ? '.env.production.local' : '.env.local'
require('dotenv').config({ path: path.join(__dirname, '..', envFile), quiet: true })

const rawUrl = process.env.DATABASE_URL ?? ''
if (!rawUrl) {
  console.error(`No DATABASE_URL in ${envFile}`)
  process.exit(1)
}
const url = new URL(rawUrl)
const sslMode = url.searchParams.get('sslmode') ?? 'disable'
const useSSL = ['require', 'verify-ca', 'verify-full'].includes(sslMode)
url.searchParams.delete('sslmode')
// Direct endpoint for DDL on Neon.
if (url.hostname.includes('-pooler')) url.hostname = url.hostname.replace('-pooler', '')

console.log(`[target=${TARGET}] host=${url.hostname} db=${url.pathname.slice(1)} ssl=${useSSL}`)

const db = require('knex')({
  client: 'pg',
  connection: { connectionString: url.toString(), ssl: useSSL ? { rejectUnauthorized: false } : false },
  pool: { min: 0, max: 5 },
  migrations: { directory: path.join(__dirname, '..', 'migrations'), extension: 'cjs' },
})

const COUNT_TABLES = [
  'clients',
  'inbox_conversations',
  'inbox_messages',
  'inbox_conversation_reads',
  'conversation_intelligence',
  'conversation_analysis_jobs',
  'conversation_intelligence_runs',
]

const REQUIRED_TABLES = [
  'inbox_conversations',
  'inbox_messages',
  'inbox_conversation_reads',
  'conversation_intelligence',
  'conversation_analysis_jobs',
  'conversation_intelligence_runs',
]

const REQUIRED_INDEXES = [
  // inbox core
  'inbox_conversations_thread_uniq',
  'inbox_conversations_lead_lastmsg_idx',
  'inbox_conversations_agency_lastmsg_idx',
  'inbox_conversations_agency_state_lastmsg_idx',
  'inbox_messages_channel_external_uniq',
  'inbox_messages_conv_created_idx',
  'inbox_messages_conv_seq_uniq',
  'inbox_participants_conv_role_uniq',
  // read model
  'inbox_conversation_reads_conv_user_uniq',
  'inbox_conversation_reads_agency_user_idx',
  // search
  'inbox_conversations_lastmsgtext_trgm_idx',
  'inbox_conversations_customerwaid_trgm_idx',
  'clients_name_trgm_idx',
  // intelligence
  'conversation_intelligence_conv_kind_uniq',
  'conversation_intelligence_agency_conv_idx',
  'conversation_analysis_jobs_pending_uniq',
  'conversation_analysis_jobs_due_idx',
  'conversation_analysis_jobs_locked_idx',
  'conversation_intelligence_runs_conv_created_idx',
  // intelligence value indexes (Phase 4)
  'conversation_intelligence_temperature_value_idx',
  'conversation_intelligence_intent_value_idx',
  'conversation_intelligence_action_value_idx',
]

async function status() {
  const [completed, pending] = await db.migrate.list()
  const cur = await db.migrate.currentVersion()
  console.log(`completed=${completed.length} pending=${pending.length} currentVersion=${cur}`)
  const batches = await db('knex_migrations').select('batch').count('* as n').groupBy('batch').orderBy('batch')
  console.log('batches:', batches.map((b) => `#${b.batch}(${b.n})`).join(' '))
  console.log('last 8 completed:')
  for (const m of completed.slice(-8)) console.log('  ✓', m.name ?? m)
  console.log(pending.length ? 'PENDING:' : 'PENDING: (none)')
  for (const m of pending) console.log('  →', m.file ?? m.name ?? m)
}

async function latest() {
  const [batch, log] = await db.migrate.latest()
  console.log(`migrate:latest → batch #${batch}`)
  console.log(log.length ? log.map((l) => '  applied: ' + l).join('\n') : '  (nothing pending)')
}

async function counts() {
  for (const t of COUNT_TABLES) {
    const exists = await db.schema.hasTable(t)
    if (!exists) {
      console.log(`  ${t}: (table missing)`)
      continue
    }
    const r = await db(t).count('* as n').first()
    console.log(`  ${t}: ${r.n}`)
  }
}

async function verify() {
  let ok = true

  console.log('tables:')
  for (const t of REQUIRED_TABLES) {
    const exists = await db.schema.hasTable(t)
    if (!exists) ok = false
    console.log(`  ${exists ? '✓' : '✗ MISSING'} ${t}`)
  }

  console.log('columns:')
  for (const [t, c] of [
    ['inbox_conversations', 'lastMessageText'],
    ['conversation_intelligence', 'confidence'],
    ['conversation_analysis_jobs', 'notBefore'],
  ]) {
    const has = await db.schema.hasColumn(t, c)
    if (!has) ok = false
    console.log(`  ${has ? '✓' : '✗ MISSING'} ${t}.${c}`)
  }

  console.log('indexes:')
  const idx = await db('pg_indexes').where('schemaname', 'public').pluck('indexname')
  const have = new Set(idx)
  for (const name of REQUIRED_INDEXES) {
    const has = have.has(name)
    if (!has) ok = false
    console.log(`  ${has ? '✓' : '✗ MISSING'} ${name}`)
  }

  // CONCURRENTLY indexes must be valid (not left INVALID by a failed build).
  const invalid = await db.raw(`
    SELECT c.relname FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT i.indisvalid
  `)
  if (invalid.rows.length) {
    ok = false
    console.log('  ✗ INVALID indexes:', invalid.rows.map((r) => r.relname).join(', '))
  } else {
    console.log('  ✓ no INVALID indexes')
  }

  console.log('pg_trgm extension:')
  const ext = await db.raw(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)
  if (!ext.rows.length) ok = false
  console.log(`  ${ext.rows.length ? '✓' : '✗ MISSING'} pg_trgm`)

  console.log('row counts:')
  await counts()

  console.log(ok ? 'VERIFY: OK' : 'VERIFY: FAILED')
  if (!ok) process.exitCode = 1
}

const CMDS = { status, latest, verify, counts }
const fn = CMDS[CMD]
if (!fn) {
  console.error(`Unknown command: ${CMD}`)
  process.exit(1)
}

fn()
  .catch((e) => {
    console.error('ERROR:', e.message ?? e)
    process.exitCode = 1
  })
  .finally(() => db.destroy())
