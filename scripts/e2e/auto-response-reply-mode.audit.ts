/**
 * Production-readiness audit for Auto Response reply modes (local DB, mocked Meta send).
 * Run: npx tsx scripts/e2e/auto-response-reply-mode.audit.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', override: true })

import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import {
  getMasterEnabled,
  setMasterEnabled,
  getChannelSettings,
  upsertChannelSettings,
} from '@/db/autoResponseSettings'
import { Roles } from '@/types/roles'

const MARK = 'AR_AUDIT'
const results: { name: string; ok: boolean; detail: string }[] = []
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const okSend = async (args: { body: string }) => {
  lastSentBody = args.body
  sentBodies.push(args.body)
  return { ok: true as const, wamid: `${MARK}_OUT_${Date.now()}_${sentBodies.length}` }
}
let lastSentBody = ''
const sentBodies: string[] = []

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
  const owners = await db('users').where('firstName', 'like', `${MARK}_owner%`).pluck('id')
  if (owners.length) {
    await db('analytics_events').whereIn('userId', owners).del()
    await db('clients').whereIn('userId', owners).del()
  }
  await db('clients').where({ firstName: MARK }).del()
  await db('whatsapp_connections').where('phone_number_id', 'like', `${MARK}_%`).del()
  if (owners.length) await db('users').whereIn('id', owners).del()
}

async function setupLead(agencyId: number, hostId: number, suffix: string) {
  const [owner] = await db('users')
    .insert({ firstName: `${MARK}_owner_${suffix}`, role: Roles.AGNT, agencyId, createdById: hostId })
    .returning('id')
  const ownerId = Number(owner.id)
  const [lead] = await db('clients')
    .insert({
      firstName: MARK,
      lastName: suffix,
      agencyId,
      createdById: hostId,
      userId: ownerId,
      status: null,
    })
    .returning('id')
  const leadId = Number(lead.id)
  // Use a real firstName for {{firstName}} in one lead
  await db('clients').where({ id: leadId }).update({ firstName: 'דנה' })
  const phone = `${MARK}_PHONE_${leadId}`
  const waid = `${MARK}_WA_${leadId}`
  await db('whatsapp_connections').insert({
    user_id: ownerId,
    agency_id: agencyId,
    phone_number_id: phone,
    access_token: `${MARK}_TOKEN`,
  })
  return { leadId, phone, waid, ownerId }
}

async function main() {
  await cleanup()

  // --- migration defaults ---
  const cols = await db.raw(`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'auto_response_settings'
      AND column_name IN ('replyMode','fixedBody','delaySeconds')
    ORDER BY column_name`)
  const byName = Object.fromEntries(cols.rows.map((r: { column_name: string }) => [r.column_name, r]))
  check('migration columns exist', !!byName.replyMode && !!byName.fixedBody && !!byName.delaySeconds)
  check(
    'replyMode defaults to ai',
    String(byName.replyMode?.column_default ?? '').includes('ai'),
    String(byName.replyMode?.column_default),
  )
  check(
    'delaySeconds defaults to 0',
    String(byName.delaySeconds?.column_default ?? '').includes('0'),
    String(byName.delaySeconds?.column_default),
  )

  const nullModes = await db('auto_response_settings').whereNull('replyMode').count<{ c: string }[]>('* as c')
  check('no null replyMode on existing rows', Number(nullModes[0]?.c ?? 0) === 0, `nulls=${nullModes[0]?.c}`)

  const host = await db('users').whereNotNull('agencyId').select('id', 'agencyId').first()
  if (!host) throw new Error('no host user')
  const agencyId: number = host.agencyId
  const priorMaster = await getMasterEnabled(agencyId)
  const priorSettings = await getChannelSettings(agencyId, 'whatsapp')

  await setMasterEnabled(agencyId, true)

  try {
    // --- AI mode (default path) ---
    sentBodies.length = 0
    await upsertChannelSettings({
      agencyId,
      channel: 'whatsapp',
      enabled: true,
      quietHours: {},
      dailyCap: 200,
      guidance: null,
      replyMode: 'ai',
      fixedBody: null,
      delaySeconds: 0,
      updatedBy: host.id,
    })
    const ai = await setupLead(agencyId, host.id, 'ai')
    const goodGenerate = async () => ({ ok: true as const, message: 'שלום! קיבלנו את פנייתך, איך נוכל לעזור?' })
    const ingAi = await ingestWhatsappInbound({
      agencyId,
      leadId: ai.leadId,
      businessPhoneNumberId: ai.phone,
      customerWaId: ai.waid,
      customerName: 'IR QA',
      rawMessage: rawMsg(`${MARK}_IN_AI`, 'שלום', ai.waid),
    })
    const rAi = await runAutoResponseWorker({
      limit: 5,
      deps: { send: okSend as never, generate: goodGenerate },
    })
    const outAi = await db('inbox_messages')
      .where({ conversationId: ingAi.conversationId, direction: 'outbound' })
      .first()
    check('AI mode sends once', rAi.sent === 1, JSON.stringify(rAi))
    check('AI outbound persisted + tagged', outAi?.metadata?.source === 'auto_response', JSON.stringify(outAi?.metadata))
    check('AI body from generate', lastSentBody.includes('איך נוכל לעזור'), lastSentBody)

    // duplicate customer messages — no second ack
    await ingestWhatsappInbound({
      agencyId,
      leadId: ai.leadId,
      businessPhoneNumberId: ai.phone,
      customerWaId: ai.waid,
      customerName: 'IR QA',
      rawMessage: rawMsg(`${MARK}_IN_AI2`, 'Hello?', ai.waid),
    })
    await ingestWhatsappInbound({
      agencyId,
      leadId: ai.leadId,
      businessPhoneNumberId: ai.phone,
      customerWaId: ai.waid,
      customerName: 'IR QA',
      rawMessage: rawMsg(`${MARK}_IN_AI3`, 'Anyone?', ai.waid),
    })
    const rDup = await runAutoResponseWorker({
      limit: 5,
      deps: { send: okSend as never, generate: goodGenerate },
    })
    const jobCount = Number(
      (await db('auto_response_jobs').where({ conversationId: ingAi.conversationId }).count('* as c'))[0].c,
    )
    check('no duplicate ack after multi inbound', jobCount === 1 && rDup.sent === 0, `jobs=${jobCount} sent=${rDup.sent}`)

    // --- Fixed mode + firstName ---
    sentBodies.length = 0
    await upsertChannelSettings({
      agencyId,
      channel: 'whatsapp',
      enabled: true,
      quietHours: {},
      dailyCap: 200,
      guidance: null,
      replyMode: 'fixed',
      fixedBody: 'שלום {{firstName}}, קיבלנו את ההודעה ונחזור אליך בהקדם!',
      delaySeconds: 0,
      updatedBy: host.id,
    })
    const fx = await setupLead(agencyId, host.id, 'fixed')
    const ingFx = await ingestWhatsappInbound({
      agencyId,
      leadId: fx.leadId,
      businessPhoneNumberId: fx.phone,
      customerWaId: fx.waid,
      customerName: 'Other Name',
      rawMessage: rawMsg(`${MARK}_IN_FX`, 'היי', fx.waid),
    })
    const rFx = await runAutoResponseWorker({
      limit: 5,
      deps: { send: okSend as never, generate: goodGenerate },
    })
    check('fixed mode sends once', rFx.sent === 1, JSON.stringify(rFx))
    check('{{firstName}} replaced with lead firstName', lastSentBody.includes('שלום דנה,'), lastSentBody)
    check('fixed does not call AI body', !lastSentBody.includes('איך נוכל לעזור'), lastSentBody)
    const outFx = await db('inbox_messages')
      .where({ conversationId: ingFx.conversationId, direction: 'outbound' })
      .first()
    check('fixed outbound tagged auto_response', outFx?.metadata?.source === 'auto_response')

    // --- Delay 5s: job not claimable immediately ---
    await upsertChannelSettings({
      agencyId,
      channel: 'whatsapp',
      enabled: true,
      quietHours: {},
      dailyCap: 200,
      guidance: null,
      replyMode: 'fixed',
      fixedBody: 'delay-test {{firstName}}',
      delaySeconds: 5,
      updatedBy: host.id,
    })
    const d5 = await setupLead(agencyId, host.id, 'd5')
    const before = Date.now()
    const ingD5 = await ingestWhatsappInbound({
      agencyId,
      leadId: d5.leadId,
      businessPhoneNumberId: d5.phone,
      customerWaId: d5.waid,
      customerName: 'Delay',
      rawMessage: rawMsg(`${MARK}_IN_D5`, 'hi', d5.waid),
    })
    const jobD5 = await db('auto_response_jobs').where({ conversationId: ingD5.conversationId }).first()
    const notBefore = new Date(jobD5.notBefore).getTime()
    const delta = notBefore - before
    check('delay 5s sets notBefore ~+5s', delta >= 4500 && delta <= 7000, `deltaMs=${delta}`)
    const rEarly = await runAutoResponseWorker({
      limit: 5,
      deps: { send: okSend as never, generate: goodGenerate },
    })
    const jobD5After = await db('auto_response_jobs').where({ conversationId: ingD5.conversationId }).first()
    check('worker does not claim before notBefore', jobD5After?.status === 'pending' && rEarly.sent === 0, `status=${jobD5After?.status} sent=${rEarly.sent}`)

    // Force due + send
    await db('auto_response_jobs').where({ id: jobD5.id }).update({ notBefore: db.fn.now() })
    const rDue = await runAutoResponseWorker({
      limit: 5,
      deps: { send: okSend as never, generate: goodGenerate },
    })
    check('worker sends after notBefore due', rDue.sent === 1, JSON.stringify(rDue))

    // --- Delay 0 ---
    await upsertChannelSettings({
      agencyId,
      channel: 'whatsapp',
      enabled: true,
      quietHours: {},
      dailyCap: 200,
      guidance: null,
      replyMode: 'fixed',
      fixedBody: 'zero delay ok',
      delaySeconds: 0,
      updatedBy: host.id,
    })
    const d0 = await setupLead(agencyId, host.id, 'd0')
    const ingD0 = await ingestWhatsappInbound({
      agencyId,
      leadId: d0.leadId,
      businessPhoneNumberId: d0.phone,
      customerWaId: d0.waid,
      customerName: 'Zero',
      rawMessage: rawMsg(`${MARK}_IN_D0`, 'hi', d0.waid),
    })
    const jobD0 = await db('auto_response_jobs').where({ conversationId: ingD0.conversationId }).first()
    const d0Delta = new Date(jobD0.notBefore).getTime() - Date.now()
    check('delay 0 notBefore ~now', Math.abs(d0Delta) < 2000, `deltaMs=${d0Delta}`)
    const r0 = await runAutoResponseWorker({
      limit: 5,
      deps: { send: okSend as never, generate: goodGenerate },
    })
    check('delay 0 sends immediately', r0.sent === 1, JSON.stringify(r0))

    // --- Delay 30s enqueue only (don't wait) ---
    await upsertChannelSettings({
      agencyId,
      channel: 'whatsapp',
      enabled: true,
      quietHours: {},
      dailyCap: 200,
      guidance: null,
      replyMode: 'fixed',
      fixedBody: 'thirty',
      delaySeconds: 30,
      updatedBy: host.id,
    })
    const d30 = await setupLead(agencyId, host.id, 'd30')
    const t30 = Date.now()
    const ingD30 = await ingestWhatsappInbound({
      agencyId,
      leadId: d30.leadId,
      businessPhoneNumberId: d30.phone,
      customerWaId: d30.waid,
      customerName: 'Thirty',
      rawMessage: rawMsg(`${MARK}_IN_D30`, 'hi', d30.waid),
    })
    const jobD30 = await db('auto_response_jobs').where({ conversationId: ingD30.conversationId }).first()
    const d30Delta = new Date(jobD30.notBefore).getTime() - t30
    check('delay 30s sets notBefore ~+30s', d30Delta >= 28000 && d30Delta <= 32000, `deltaMs=${d30Delta}`)
    const r30 = await runAutoResponseWorker({
      limit: 5,
      deps: { send: okSend as never, generate: goodGenerate },
    })
    const jobD30After = await db('auto_response_jobs').where({ conversationId: ingD30.conversationId }).first()
    check('delay 30s not claimed early', jobD30After?.status === 'pending' && r30.sent === 0, `status=${jobD30After?.status}`)
    // no second job on re-ingest while pending
    await ingestWhatsappInbound({
      agencyId,
      leadId: d30.leadId,
      businessPhoneNumberId: d30.phone,
      customerWaId: d30.waid,
      customerName: 'Thirty',
      rawMessage: rawMsg(`${MARK}_IN_D30b`, 'again', d30.waid),
    })
    const jobs30 = Number(
      (await db('auto_response_jobs').where({ conversationId: ingD30.conversationId }).count('* as c'))[0].c,
    )
    check('delay pending: no duplicate job', jobs30 === 1, `jobs=${jobs30}`)
  } finally {
    await setMasterEnabled(agencyId, priorMaster)
    if (priorSettings) {
      await upsertChannelSettings({
        agencyId: priorSettings.agencyId,
        channel: priorSettings.channel,
        enabled: priorSettings.enabled,
        quietHours: priorSettings.quietHours,
        dailyCap: priorSettings.dailyCap,
        guidance: priorSettings.guidance,
        replyMode: priorSettings.replyMode,
        fixedBody: priorSettings.fixedBody,
        delaySeconds: priorSettings.delaySeconds,
        updatedBy: host.id,
      })
    } else await db('auto_response_settings').where({ agencyId, channel: 'whatsapp' }).del()
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
    console.error(e)
  }
  const passed = results.filter((r) => r.ok).length
  const allPass = !fatal && results.length > 0 && results.every((r) => r.ok)
  console.log(`\n================ AUTO RESPONSE REPLY-MODE AUDIT ================`)
  console.log(`${allPass ? 'PASS' : 'FAIL'}  (${passed}/${results.length} checks)`)
  if (fatal) console.log(`FATAL: ${fatal}`)
  console.log(`================================================================`)
  await db.destroy()
  process.exit(allPass ? 0 : 1)
})()
