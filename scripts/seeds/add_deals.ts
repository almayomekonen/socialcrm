/**
 * Add N more deals to EXISTING seeded leads/clients (no new leads).
 *   SEED_CONFIRM=YES DEAL_COUNT=7 npx tsx scripts/seeds/add_deals.ts
 */
import knex from 'knex'
import dotenv from 'dotenv'

const AGENCY_ID = 53
const TARGET_EMAIL = 'alamayo274@gmail.com'
const COUNT = Number(process.env.DEAL_COUNT || 7)

const env = dotenv.config({ path: '.env.production.local' }).parsed ?? {}
const raw = process.env.SEED_DATABASE_URL || env.DATABASE_URL || ''
if (!raw) { console.error('❌ no prod DATABASE_URL'); process.exit(1) }
const u = new URL(raw)
const ssl = ['require', 'verify-ca', 'verify-full'].includes(u.searchParams.get('sslmode') ?? 'disable')
u.searchParams.delete('sslmode')
console.log(`\n🎯 Target DB host: ${u.hostname}`)
if (process.env.SEED_CONFIRM !== 'YES') { console.error('⛔ set SEED_CONFIRM=YES to write'); process.exit(1) }

const db = knex({ client: 'pg', connection: { connectionString: u.toString(), ssl: ssl ? { rejectUnauthorized: false } : false }, pool: { min: 0, max: 5 } })
const rand = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
const randNum = (lo: number, hi: number) => Math.floor(Math.random() * (hi - lo + 1)) + lo
const monthsAgo = (n: number) => new Date(Date.now() - n * 30 * 864e5)
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)
function pick(row: Record<string, any>, cols: Set<string>) {
  const out: Record<string, any> = {}
  for (const k of Object.keys(row)) if (cols.has(k)) out[k] = row[k]
  return out
}

const dealsCatalog = [
  { branch: 'שירותים', prdct: 'ניהול מדיה חברתית', prdctType: 'תשלום חודשי', company: 'Meta', amount: 3500 },
  { branch: 'שירותים', prdct: 'פרסום ממומן', prdctType: 'תשלום חודשי', company: 'Google', amount: 5000 },
  { branch: 'מוצרים', prdct: 'בניית אתר', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 8500 },
  { branch: 'מוצרים', prdct: 'זהות מותגית', prdctType: 'תשלום חד פעמי', company: 'ללא ספק', amount: 4800 },
  { branch: 'ייעוץ', prdct: 'ליווי עסקי', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 3500 },
  { branch: 'חבילות', prdct: 'חבילת פרו', prdctType: 'תשלום חודשי', company: 'ללא ספק', amount: 5500 },
  { branch: 'חבילות', prdct: 'חבילת מדיה', prdctType: 'תשלום חד פעמי', company: 'Meta', amount: 18000 },
]
const dealStatuses = ['חדש', 'בהצעה', 'במו"מ', 'ממתין לתשלום', 'שולם']
const notes = ['לקוח מאוד מעוניין, לחזור בשבוע הבא', 'שלחנו הצעה מפורטת', 'מנהל משא ומתן על תנאים', 'ביקש לשדרג חבילה', null]

;(async () => {
  const user = await db('users').where({ email: TARGET_EMAIL }).first()
  const userId = user.id
  const salesCols = new Set((await db('information_schema.columns').where({ table_name: 'sales', table_schema: 'public' }).select('column_name')).map((r: any) => r.column_name))
  const suCols = new Set((await db('information_schema.columns').where({ table_name: 'sale_users', table_schema: 'public' }).select('column_name')).map((r: any) => r.column_name))

  const seedClients = await db('clients').where({ agencyId: AGENCY_ID }).whereLike('email', 'seed.%@example-crm.com').select('id', 'lead')
  if (!seedClients.length) { console.error('❌ no seed clients found'); await db.destroy(); process.exit(1) }
  const clients = seedClients.filter((c: any) => c.lead === false)
  const leads = seedClients.filter((c: any) => c.lead === true)
  console.log(`Found ${seedClients.length} seed records (${leads.length} leads, ${clients.length} clients). Adding ${COUNT} deals...`)

  let ok = 0
  for (let i = 0; i < COUNT; i++) {
    const cat = rand(dealsCatalog)
    const status = rand(dealStatuses)
    const isPaid = status === 'שולם'
    const target = isPaid ? rand(clients.length ? clients : seedClients) : rand(leads.length ? leads : seedClients)
    const isMonthly = cat.prdctType === 'תשלום חודשי'
    const tfuca = isMonthly ? cat.amount * 12 : cat.amount
    const cmsn = Math.round(tfuca * (randNum(8, 15) / 100))
    const offrDt = monthsAgo(randNum(0, 6))
    const saleDt = isPaid ? daysAgo(randNum(1, 45)) : null

    const saleRow = pick({
      status, action: 'מכירה', company: cat.company, branch: cat.branch, prdct: cat.prdct, prdctType: cat.prdctType,
      offrDt, saleDt, clientId: target.id, createdById: userId, handlerId: userId, userId,
      amount: cat.amount, cmsn, notes: rand(notes), agencyId: AGENCY_ID, createdAt: offrDt, updatedAt: saleDt ?? offrDt,
    }, salesCols)

    try {
      const [sale] = await db('sales').insert(saleRow).returning('id')
      await db('sale_users').insert(pick({ saleId: sale.id, userId, prcnt: 100, amount: cat.amount, cmsn, tfuca }, suCols))
      ok++
      console.log(`  ✓ deal ${i + 1}: ${cat.prdct} (${status}) → client ${target.id}`)
    } catch (e: any) {
      console.log(`  ⚠ deal ${i + 1}: ${e.message}`)
    }
  }
  console.log(`\n✅ Added ${ok}/${COUNT} deals.`)
  await db.destroy()
})().catch(async (e) => { console.error('Fatal:', e.message); await db.destroy(); process.exit(1) })
