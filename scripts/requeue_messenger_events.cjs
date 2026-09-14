/**
 * requeue_messenger_events.cjs — operator recovery for Messenger webhook receipts
 * that reached the terminal `failed` state (their attempt budget was spent).
 *
 *   node scripts/requeue_messenger_events.cjs status                 # counts by status
 *   node scripts/requeue_messenger_events.cjs failed                 # failed receipts: id, agency, attempts, error class
 *   node scripts/requeue_messenger_events.cjs requeue --ids 12,13    # dry run
 *   node scripts/requeue_messenger_events.cjs requeue --agency 103 --apply
 *
 *   ENV_FILE=.env.production.local node scripts/requeue_messenger_events.cjs status
 *
 * Requeue resets `attempts` and makes the receipts due now; the next worker run
 * (webhook kick or the /api/cron/messenger-events backstop) processes them.
 * Re-processing is idempotent: an already-stored message settles as `duplicate`.
 *
 * Never prints payloads, message text, PSIDs or Page ids. Dry run unless --apply.
 */
const ENV_FILE = process.env.ENV_FILE || '.env.local'
require('dotenv').config({ path: ENV_FILE, override: true })

const knex = require('knex')({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
  },
  pool: { min: 0, max: 2 },
})

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}

async function main() {
  const cmd = process.argv[2]
  if (cmd === 'status') {
    const rows = await knex('messenger_webhook_events').select('status').count({ n: '*' }).groupBy('status')
    for (const r of rows) console.log(`${r.status}\t${r.n}`)
    return
  }
  if (cmd === 'failed') {
    const rows = await knex('messenger_webhook_events')
      .where({ status: 'failed' })
      .orderBy('id')
      .limit(200)
      .select('id', 'agencyId', 'attempts', 'lastError', 'receivedAt')
    for (const r of rows) console.log(`${r.id}\tagency=${r.agencyId}\tattempts=${r.attempts}\t${r.lastError ?? ''}\t${new Date(r.receivedAt).toISOString()}`)
    console.log(`${rows.length} failed receipt(s) shown`)
    return
  }
  if (cmd === 'requeue') {
    const ids = arg('--ids')
    const agency = arg('--agency')
    if (!ids && !agency) throw new Error('requeue needs --ids 1,2,3 or --agency <id>')
    const q = knex('messenger_webhook_events').where({ status: 'failed' })
    if (ids) q.whereIn('id', ids.split(',').map((x) => Number(x)).filter(Number.isFinite))
    if (agency) q.where({ agencyId: Number(agency) })
    const matched = await q.clone().count({ n: '*' }).first()
    console.log(`${matched.n} failed receipt(s) match`)
    if (!process.argv.includes('--apply')) {
      console.log('dry run — re-run with --apply to requeue')
      return
    }
    const n = await q.update({ status: 'received', attempts: 0, nextAttemptAt: knex.fn.now(), lastError: null, updatedAt: knex.fn.now() })
    console.log(`${n} receipt(s) requeued`)
    return
  }
  throw new Error('usage: status | failed | requeue (--ids a,b | --agency id) [--apply]')
}

main()
  .catch((err) => {
    console.error(`error: ${err.message}`)
    process.exitCode = 1
  })
  .finally(() => knex.destroy())
