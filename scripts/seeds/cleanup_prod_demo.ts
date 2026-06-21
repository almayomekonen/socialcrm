/**
 * Cleanup for seed_prod_demo.ts. Deletes every demo row and its dependents,
 * keyed off the seed-client email tag (seed.%@example-crm.com). Reversible-safe:
 * touches only rows that descend from tagged seed clients.
 *
 *   SEED_CONFIRM=YES npx tsx scripts/seeds/cleanup_prod_demo.ts
 */
import knex from 'knex'
import dotenv from 'dotenv'

const AGENCY_ID = 53
const env = dotenv.config({ path: '.env.production.local' }).parsed ?? {}
const raw = process.env.SEED_DATABASE_URL || env.DATABASE_URL || ''
if (!raw) { console.error('❌ no prod DATABASE_URL'); process.exit(1) }
const u = new URL(raw)
const ssl = ['require', 'verify-ca', 'verify-full'].includes(u.searchParams.get('sslmode') ?? 'disable')
u.searchParams.delete('sslmode')
console.log(`\n🎯 Target DB host: ${u.hostname}`)
if (process.env.SEED_CONFIRM !== 'YES') { console.error('⛔ set SEED_CONFIRM=YES to delete'); process.exit(1) }

const db = knex({ client: 'pg', connection: { connectionString: u.toString(), ssl: ssl ? { rejectUnauthorized: false } : false }, pool: { min: 0, max: 5 } })

;(async () => {
  const seedClients = await db('clients').where({ agencyId: AGENCY_ID }).whereLike('email', 'seed.%@example-crm.com').select('id')
  const ids = seedClients.map((r: any) => r.id)
  console.log(`Found ${ids.length} seed clients.`)
  if (ids.length === 0) { console.log('Nothing to clean.'); await db.destroy(); return }

  // inbox: conversations by leadId → messages + participants
  const convs = await db('inbox_conversations').whereIn('leadId', ids).select('id')
  const convIds = convs.map((r: any) => r.id)
  if (convIds.length) {
    const m = await db('inbox_messages').whereIn('conversationId', convIds).del()
    const p = await db('inbox_participants').whereIn('conversationId', convIds).del()
    const c = await db('inbox_conversations').whereIn('id', convIds).del()
    console.log(`inbox: ${c} conversations, ${m} messages, ${p} participants deleted`)
  }

  // deals: sales by clientId → sale_users
  const sales = await db('sales').whereIn('clientId', ids).select('id')
  const saleIds = sales.map((r: any) => r.id)
  if (saleIds.length) {
    const su = await db('sale_users').whereIn('saleId', saleIds).del()
    const s = await db('sales').whereIn('id', saleIds).del()
    console.log(`deals: ${s} sales, ${su} sale_users deleted`)
  }

  const t = await db('tasks').whereIn('clientId', ids).del()
  console.log(`tasks: ${t} deleted`)

  const mt = await db('meetings').whereIn('lead_id', ids).del()
  console.log(`meetings: ${mt} deleted`)

  const cl = await db('clients').whereIn('id', ids).del()
  console.log(`clients: ${cl} deleted`)

  console.log('\n✅ Cleanup complete.')
  await db.destroy()
})().catch(async (e) => { console.error('Fatal:', e.message); await db.destroy(); process.exit(1) })
