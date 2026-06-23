/**
 * Recovery Engine — fully automated end-to-end validation.
 *
 * Proves the whole chain against the REAL code paths and LIVE endpoints:
 *   customer message → waiting → detection → GET → (n8n GET→POST chain) →
 *   create-recovery-alert → Recovery Center visibility (+permissions/ownership)
 *   → agent reply via persistOutboundWhatsapp → auto-resolve.
 *
 * Fast & safe (no 30-minute wait): the "waiting" state is fabricated by writing
 * a backdated `lastInboundAt` through the real bump function — detection's clock
 * is data, not wall-time. Nothing here changes schema or business logic; it only
 * creates throwaway fixtures and deletes them in a finally block.
 *
 * Run (dev server must be up on BASE_URL):
 *   npx tsx scripts/e2e/recovery-engine.e2e.ts
 * Env: CRON_SECRET (from .env.local), optional BASE_URL (default localhost:3000).
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', override: true })

import { db } from '@/config/db'
import { findOrCreateConversation, bumpConversationOnInbound } from '@/db/inboxConversations'
import { getLeadsWaitingForReply } from '@/services/automation/recoveryEngine'
import { getRecoveryAlerts } from '@/db/recoveryAlerts'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { Roles } from '@/types/roles'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const SECRET = (process.env.CRON_SECRET ?? process.env.AUTOMATION_API_KEY ?? '').trim()
const MARK = 'QA_E2E'
const PHONE = `${MARK}_PHONE_${Date.now()}`
const WAID = `${MARK}_WA_${Date.now()}`

type Stage = 'detection' | 'api' | 'n8n' | 'recovery_center' | 'auto_resolve'
const results: { stage: Stage; name: string; ok: boolean; detail: string }[] = []
function check(stage: Stage, name: string, ok: boolean, detail = '') {
  results.push({ stage, name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${stage}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function post(body: unknown, secret = SECRET) {
  const r = await fetch(`${BASE_URL}/api/automation/create-recovery-alert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-cron-secret': secret } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  let json: any = null
  try { json = await r.json() } catch { /* non-JSON */ }
  return { status: r.status, json }
}
async function getLeads(qs: string, secret = SECRET) {
  const r = await fetch(`${BASE_URL}/api/automation/recovery-leads?${qs}`, {
    headers: secret ? { 'x-cron-secret': secret } : {},
  })
  let json: any = null
  try { json = await r.json() } catch { /* */ }
  return { status: r.status, json }
}

async function cleanup() {
  // Order: alerts/jobs/intel/messages/participants → conversations → clients → users.
  const leads = await db('clients').where({ firstName: MARK }).pluck('id')
  const convs = await db('inbox_conversations').where('businessPhoneNumberId', 'like', `${MARK}_%`).pluck('id')
  if (leads.length) await db('recovery_alerts').whereIn('leadId', leads).del()
  if (convs.length) {
    await db('conversation_analysis_jobs').whereIn('conversationId', convs).del()
    await db('conversation_intelligence').whereIn('conversationId', convs).del()
    await db('inbox_messages').whereIn('conversationId', convs).del()
    await db('inbox_participants').whereIn('conversationId', convs).del()
    await db('inbox_conversations').whereIn('id', convs).del()
  }
  if (leads.length) await db('clients').whereIn('id', leads).del()
  await db('users').where('firstName', 'like', `${MARK}_owner%`).del()
}

async function main() {
  if (!SECRET) throw new Error('CRON_SECRET not set in env — cannot exercise endpoints')
  await cleanup() // start from a clean slate

  // ---- discover a host agency + a creator user (portable, no hardcoding) ----
  const host = await db('users').whereNotNull('agencyId').select('id', 'agencyId').first()
  if (!host) throw new Error('No users in DB to host fixtures')
  const agencyId: number = host.agencyId

  // ---- fixtures: two owners, one waiting lead owned by ownerA ----
  const [ownerA] = await db('users').insert({ firstName: `${MARK}_ownerA`, role: Roles.AGNT, agencyId, createdById: host.id }).returning('id')
  const [ownerB] = await db('users').insert({ firstName: `${MARK}_ownerB`, role: Roles.AGNT, agencyId, createdById: host.id }).returning('id')
  const ownerAId = Number(ownerA.id), ownerBId = Number(ownerB.id)

  const [lead] = await db('clients').insert({
    firstName: MARK, lastName: 'RecoveryLead', agencyId, createdById: host.id, userId: ownerAId, status: null,
  }).returning('id')
  const leadId = Number(lead.id)

  // waiting conversation: backdate lastInboundAt to 60m ago via the real bump fn
  const sixtyAgo = new Date(Date.now() - 60 * 60_000)
  const convId = await db.transaction(async (trx) => {
    const id = await findOrCreateConversation(trx, {
      agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: PHONE, customerWaId: WAID, customerName: 'QA E2E Customer',
    })
    await bumpConversationOnInbound(trx, id, sixtyAgo, 'שלום, אשמח לפרטים')
    return id
  })
  console.log(`fixtures: agency=${agencyId} lead=${leadId} conv=${convId} ownerA=${ownerAId} ownerB=${ownerBId}\n`)

  // ===== STAGE 1: DETECTION (real recoveryEngine) =====
  const det = await getLeadsWaitingForReply({ thresholdMinutes: 30, agencyId })
  const mine = det.find((d) => d.leadId === String(leadId))
  check('detection', 'waiting lead detected', !!mine, mine ? `waitingMinutes=${mine.waitingMinutes}` : 'not found')
  check('detection', 'waitingMinutes past threshold', !!mine && mine.waitingMinutes >= 30, `${mine?.waitingMinutes}`)
  check('detection', 'appears exactly once', det.filter((d) => d.leadId === String(leadId)).length === 1)

  // ===== STAGE 2: API (GET auth + POST contract) =====
  const gAuth = await getLeads(`agencyId=${agencyId}&minutes=30`)
  check('api', 'GET 200 with secret', gAuth.status === 200, `status=${gAuth.status}`)
  check('api', 'GET returns fixture lead', Array.isArray(gAuth.json) && gAuth.json.some((l: any) => l.leadId === String(leadId)))
  const gNo = await getLeads(`agencyId=${agencyId}`, '')
  check('api', 'GET 403 without secret', gNo.status === 403, `status=${gNo.status}`)
  const pBad = await post({})
  check('api', 'POST 400 missing leadId', pBad.status === 400, `status=${pBad.status}`)
  const pJson = await post('not-json')
  check('api', 'POST 400 invalid JSON', pJson.status === 400, `status=${pJson.status}`)
  const pUnauth = await post({ leadId }, 'wrong')
  check('api', 'POST 403 unauthorized', pUnauth.status === 403, `status=${pUnauth.status}`)
  const pNot = await post({ leadId: 999999999 })
  check('api', 'POST 200 not_waiting (absent lead)', pNot.status === 200 && pNot.json?.reason === 'not_waiting', `${pNot.status}/${pNot.json?.reason}`)

  // ===== STAGE 3: n8n CHAIN (GET → for each lead → POST), incl. dedup =====
  const chain = await getLeads(`agencyId=${agencyId}&minutes=30`)
  const targets = (chain.json as any[]).filter((l) => l.leadId === String(leadId))
  const created = await post({ leadId }) // first POST in the chain
  check('n8n', 'chain POST creates alert', created.status === 201 && created.json?.created === true, `${created.status}/${JSON.stringify(created.json)}`)
  const dup = await post({ leadId }) // overlapping run / second pass
  check('n8n', 'duplicate prevented', dup.status === 200 && dup.json?.reason === 'duplicate', `${dup.status}/${dup.json?.reason}`)
  check('n8n', 'GET yielded exactly one target for lead', targets.length === 1)
  const openCount = await db('recovery_alerts').where({ leadId, status: 'open' }).count<{ c: string }[]>('* as c')
  check('n8n', 'exactly one OPEN alert in DB', Number(openCount[0].c) === 1, `count=${openCount[0].c}`)

  // ===== STAGE 4: RECOVERY CENTER (visibility + permissions + ownership) =====
  const adminView = await getRecoveryAlerts(agencyId, Roles.ADMIN, [], { status: 'open' })
  check('recovery_center', 'admin sees alert', adminView.some((a) => a.leadId === String(leadId)))
  const ownerView = await getRecoveryAlerts(agencyId, Roles.AGNT, [ownerAId], { status: 'open' })
  check('recovery_center', 'owning agent sees alert', ownerView.some((a) => a.leadId === String(leadId)))
  const otherView = await getRecoveryAlerts(agencyId, Roles.AGNT, [ownerBId], { status: 'open' })
  check('recovery_center', 'non-owning agent excluded', !otherView.some((a) => a.leadId === String(leadId)))
  const row = adminView.find((a) => a.leadId === String(leadId))
  check('recovery_center', 'view has required fields', !!row && row.leadName === `${MARK} RecoveryLead` && typeof row.waitingMinutes === 'number' && row.status === 'open')

  // ===== STAGE 5: AUTO-RESOLVE (real reply path) =====
  const reply = await persistOutboundWhatsapp({
    agencyId, leadId, businessPhoneNumberId: PHONE, customerWaId: WAID, customerName: 'QA E2E Customer',
    sentByUserId: ownerAId, wamid: `${MARK}_REPLY_${Date.now()}`, text: 'חזרנו אליך, מצטערים על העיכוב',
  })
  check('auto_resolve', 'reply persisted', !!reply.conversationId && !!reply.messageId)
  const afterOpen = await getRecoveryAlerts(agencyId, Roles.ADMIN, [], { status: 'open' })
  check('auto_resolve', 'removed from open list', !afterOpen.some((a) => a.leadId === String(leadId)))
  const alertRow = await db('recovery_alerts').where({ leadId }).orderBy('id', 'desc').first()
  check('auto_resolve', 'alert status=resolved + resolvedAt set', alertRow?.status === 'resolved' && !!alertRow?.resolvedAt)
  const orphans = await db('recovery_alerts as a')
    .join('inbox_conversations as cv', 'cv.leadId', 'a.leadId')
    .where({ 'a.leadId': leadId, 'a.status': 'open', 'cv.lastDirection': 'outbound' }).count<{ c: string }[]>('* as c')
  check('auto_resolve', 'no orphan open alerts', Number(orphans[0].c) === 0)
}

;(async () => {
  let fatal: string | null = null
  try { await main() } catch (e) { fatal = (e as Error).message; console.error('\nFATAL:', fatal) }
  finally { await cleanup() }

  // ---- final report ----
  const stages: Stage[] = ['detection', 'api', 'n8n', 'recovery_center', 'auto_resolve']
  console.log('\n================ RECOVERY ENGINE E2E REPORT ================')
  let allPass = !fatal
  for (const s of stages) {
    const rows = results.filter((r) => r.stage === s)
    const pass = rows.length > 0 && rows.every((r) => r.ok)
    if (!pass) allPass = false
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${s.toUpperCase().padEnd(16)} (${rows.filter((r) => r.ok).length}/${rows.length})`)
    rows.filter((r) => !r.ok).forEach((r) => console.log(`        ↳ FAILED: ${r.name} ${r.detail}`))
  }
  if (fatal) console.log(`FATAL: ${fatal}`)
  console.log(`\nOVERALL: ${allPass ? 'PASS' : 'FAIL'}`)
  console.log('===========================================================')
  await db.destroy()
  process.exit(allPass ? 0 : 1)
})()
