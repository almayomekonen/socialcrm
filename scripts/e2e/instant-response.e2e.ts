import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', override: true })

import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { getMasterEnabled, setMasterEnabled, getChannelSettings, upsertChannelSettings } from '@/db/autoResponseSettings'
import { Roles } from '@/types/roles'

const MARK = 'IR_E2E'
const results: { name: string; ok: boolean; detail: string }[] = []
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const okSend = async () => ({ ok: true as const, wamid: `${MARK}_OUT_${Date.now()}_${Math.floor(performance.now())}` })
const goodGenerate = async () => ({ ok: true as const, message: 'שלום! קיבלנו את פנייתך, איך נוכל לעזור?' })
const forbiddenGenerate = async () => ({ ok: true as const, message: 'המחיר שלנו הוא 200 ש"ח, מתאים?' })

function rawMsg(wamid: string, body: string, waid: string) {
  return { id: wamid, from: waid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }
}

async function cleanup() {
  const convs = await db('inbox_conversations').where('businessPhoneNumberId', 'like', `${MARK}_%`).pluck('id')
  if (convs.length) {
    await db('auto_response_jobs').whereIn('conversationId', convs).del()
    await db('conversation_analysis_jobs').whereIn('conversationId', convs).del()
    await db('conversation_intelligence').whereIn('conversationId', convs).del()
    await db('inbox_messages').whereIn('conversationId', convs).del()
    await db('inbox_participants').whereIn('conversationId', convs).del()
    await db('inbox_conversations').whereIn('id', convs).del()
  }
  await db('clients').where({ firstName: MARK }).del()
  await db('whatsapp_connections').where('phone_number_id', 'like', `${MARK}_%`).del()

  const qaUsers = await db('users').where('firstName', 'like', `${MARK}_owner%`).pluck('id')
  if (qaUsers.length) await db('analytics_events').whereIn('userId', qaUsers).del()
  await db('users').where('firstName', 'like', `${MARK}_owner%`).del()
}

async function main() {
  await cleanup()
  const host = await db('users').whereNotNull('agencyId').select('id', 'agencyId').first()
  if (!host) throw new Error('no host user')
  const agencyId: number = host.agencyId

  // snapshot host agency settings to restore later
  const priorMaster = await getMasterEnabled(agencyId)
  const priorSettings = await getChannelSettings(agencyId, 'whatsapp')

  const [owner] = await db('users')
    .insert({ firstName: `${MARK}_owner`, role: Roles.AGNT, agencyId, createdById: host.id })
    .returning('id')
  const ownerId = Number(owner.id)
  const [lead] = await db('clients')
    .insert({ firstName: MARK, lastName: 'Lead', agencyId, createdById: host.id, userId: ownerId, status: null })
    .returning('id')
  const leadId = Number(lead.id)
  const phone = `${MARK}_PHONE_${leadId}`
  const waid = `${MARK}_WA_${leadId}`
  await db('whatsapp_connections').insert({
    user_id: ownerId,
    agency_id: agencyId,
    phone_number_id: phone,
    access_token: `${MARK}_TOKEN`,
  })

  await setMasterEnabled(agencyId, true)
  await upsertChannelSettings({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    quietHours: {},
    dailyCap: 200,
    guidance: null,
    updatedBy: host.id,
  })

  try {
    // ---- STAGE 1: inbound ingest enqueues a guarded first_contact job ----
    const ing = await ingestWhatsappInbound({
      agencyId,
      leadId,
      businessPhoneNumberId: phone,
      customerWaId: waid,
      customerName: 'IR QA',
      rawMessage: rawMsg(`${MARK}_IN_1`, 'שלום, אפשר פרטים?', waid),
    })
    const job = await db('auto_response_jobs').where({ conversationId: ing.conversationId }).first()
    check(
      'inbound enqueues first_contact job',
      !!job && job.reason === 'first_contact' && job.status === 'pending',
      job ? `status=${job.status}` : 'no job',
    )

    // ---- STAGE 2: worker sends (fake deps) → 'sent' + tagged message ----
    const r1 = await runAutoResponseWorker({ limit: 5, deps: { send: okSend, generate: goodGenerate } })
    check('worker reports one sent', r1.sent === 1, JSON.stringify(r1))
    const jobAfter = await db('auto_response_jobs').where({ conversationId: ing.conversationId }).first()
    check('job marked sent', jobAfter?.status === 'sent', `status=${jobAfter?.status}`)
    const outMsg = await db('inbox_messages').where({ conversationId: ing.conversationId, direction: 'outbound' }).first()
    check(
      'tagged outbound auto_response message exists',
      !!outMsg && outMsg.metadata?.source === 'auto_response',
      outMsg ? `source=${outMsg.metadata?.source}` : 'no outbound',
    )
    const conv = await db('inbox_conversations').where({ id: ing.conversationId }).first()
    check('conversation flipped to outbound', conv?.lastDirection === 'outbound', `lastDirection=${conv?.lastDirection}`)

    // ---- STAGE 3: duplicate inbound does NOT re-ack ----
    await ingestWhatsappInbound({
      agencyId,
      leadId,
      businessPhoneNumberId: phone,
      customerWaId: waid,
      customerName: 'IR QA',
      rawMessage: rawMsg(`${MARK}_IN_2`, 'עוד שאלה', waid),
    })
    const r2 = await runAutoResponseWorker({ limit: 5, deps: { send: okSend, generate: goodGenerate } })
    const jobCount = Number((await db('auto_response_jobs').where({ conversationId: ing.conversationId }).count('* as c'))[0].c)
    check('no duplicate ack (one job total, none re-sent)', jobCount === 1 && r2.sent === 0, `jobs=${jobCount} sent=${r2.sent}`)

    // ---- STAGE 4: guardrail blocks a forbidden generation (no send) ----
    const [lead2] = await db('clients')
      .insert({ firstName: MARK, lastName: 'Lead2', agencyId, createdById: host.id, userId: ownerId, status: null })
      .returning('id')
    const lead2Id = Number(lead2.id)
    const phone2 = `${MARK}_PHONE_${lead2Id}`
    const waid2 = `${MARK}_WA_${lead2Id}`
    await db('whatsapp_connections').insert({
      user_id: ownerId,
      agency_id: agencyId,
      phone_number_id: phone2,
      access_token: `${MARK}_TOKEN`,
    })
    const ing2 = await ingestWhatsappInbound({
      agencyId,
      leadId: lead2Id,
      businessPhoneNumberId: phone2,
      customerWaId: waid2,
      customerName: 'IR QA2',
      rawMessage: rawMsg(`${MARK}_IN_3`, 'היי', waid2),
    })
    let sentCalls = 0
    const countingSend = async () => {
      sentCalls++
      return okSend()
    }
    const r3 = await runAutoResponseWorker({ limit: 5, deps: { send: countingSend, generate: forbiddenGenerate } })
    const job2 = await db('auto_response_jobs').where({ conversationId: ing2.conversationId }).first()
    check(
      'forbidden generation blocked (skipped, never sent)',
      job2?.status === 'skipped' && job2?.skipReason === 'validation_failed' && sentCalls === 0 && r3.sent === 0,
      `status=${job2?.status} reason=${job2?.skipReason} sendCalls=${sentCalls}`,
    )
  } finally {
    // restore host agency settings
    await setMasterEnabled(agencyId, priorMaster)
    if (priorSettings) await upsertChannelSettings({ ...priorSettings, updatedBy: host.id })
    else await db('auto_response_settings').where({ agencyId, channel: 'whatsapp' }).del()
    await cleanup()
  }
}

;(async () => {
  let fatal: string | null = null
  try {
    await main()
  } catch (e) {
    fatal = (e as Error).message
    console.error('\nFATAL:', fatal)
  }
  const passed = results.filter((r) => r.ok).length
  const allPass = !fatal && results.every((r) => r.ok)
  console.log(`\n================ INSTANT RESPONSE E2E ================`)
  console.log(`${allPass ? 'PASS' : 'FAIL'}  (${passed}/${results.length} checks)`)
  if (fatal) console.log(`FATAL: ${fatal}`)
  console.log(`=====================================================`)
  await db.destroy()
  process.exit(allPass ? 0 : 1)
})()
