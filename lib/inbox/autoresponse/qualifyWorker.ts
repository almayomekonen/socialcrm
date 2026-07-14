import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { sendWhatsappText, formatWhatsappSendFailure } from '@/lib/whatsapp/sendMessage'
import {
  skipAutoResponseJob,
  completeAutoResponseJob,
  failAutoResponseJob,
  countSentToday,
  type AutoResponseJob,
} from '@/db/autoResponseJobs'
import type { AutoResponseSettings } from '@/db/autoResponseSettings'
import { getOrCreateAiState, recordTurn, mergeOnly, markEscalated, markHumanActive, markStopped } from '@/db/conversationAiState'
import { upsertManyConversationIntelligence, getMaxMessageSequence, INTEL_KIND_TEMPERATURE } from '@/db/conversationIntelligence'
import { insertQualifyDraftReview } from '@/db/qualifyDraftReview'
import { mergeQualification, requiredComplete } from './qualification'
import { decidePreGeneration, decidePostGeneration } from './stateMachine'
import { generateQualifyTurn, handoffMessage, detectLang, detectOptOut, type QualifyGenResult } from './qualify'
import { buildSummary, type EscalationSummary } from './summary'
import { isQualifierEnabled } from './killSwitch'
import { validateAutoResponse } from './validate'
import { withinQuietHours } from './worker'
import { shadowIngestQualification } from '@/lib/ai/integration/shadowIngest'
import { shadowReasonAndDecide } from '@/lib/ai/integration/shadowCognition'

type Outcome = 'sent' | 'skipped' | 'failed'

export interface QualifyCtx {
  master: boolean
  settings: AutoResponseSettings
  conv: { id: number; businessPhoneNumberId: string; customerWaId: string | null; customerName: string | null }
  lead: { id: number; userId: number | null; handlerId: number | null; status: string | null }
}
export interface QualifyDeps {
  send: typeof sendWhatsappText
  generateQualify: typeof generateQualifyTurn
}

const WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_TRANSCRIPT = 14

function metaSource(metadata: unknown): string {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return (m as { source?: string } | null)?.source ?? ''
  } catch {
    return ''
  }
}

/** Send + persist an outbound AI message (tagged source=auto_response). */
async function sendAndPersist(
  job: AutoResponseJob,
  ctx: QualifyCtx,
  send: typeof sendWhatsappText,
  text: string,
): Promise<{ ok: true; messageId: number } | { ok: false; reason: string }> {
  const connection = await db('whatsapp_connections')
    .where({ phone_number_id: ctx.conv.businessPhoneNumberId, agency_id: job.agencyId })
    .first('phone_number_id', 'access_token', 'user_id')
  if (!connection) return { ok: false, reason: 'no_connection' }
  const to = ctx.conv.customerWaId
  if (!to) return { ok: false, reason: 'no_recipient' }

  const sent = await send({ phoneNumberId: ctx.conv.businessPhoneNumberId, accessToken: connection.access_token, to, body: text })
  if (sent.ok === false) {
    const detail = formatWhatsappSendFailure(sent)
    return { ok: false, reason: detail }
  }

  const sentByUserId = ctx.lead.userId ?? ctx.lead.handlerId ?? connection.user_id
  const res = await persistOutboundWhatsapp({
    agencyId: job.agencyId,
    leadId: job.leadId,
    businessPhoneNumberId: ctx.conv.businessPhoneNumberId,
    customerWaId: to,
    customerName: ctx.conv.customerName ?? null,
    sentByUserId,
    wamid: sent.wamid,
    text,
  })
  await db('inbox_messages')
    .where({ id: res.messageId })
    .update({
      metadata: db.raw(`metadata || ?::jsonb`, [JSON.stringify({ source: 'auto_response', reason: job.reason, phase: 2 })]),
    })
  return { ok: true, messageId: res.messageId }
}

async function persistEscalation(conversationId: number, agencyId: number, summary: EscalationSummary): Promise<void> {
  const coveredSequence = await getMaxMessageSequence(conversationId)
  const base = {
    conversationId,
    agencyId,
    channel: 'whatsapp',
    status: 'fresh' as const,
    schemaVersion: 1,
    analyzerVersion: 'qualifier-v1',
    coveredSequence,
  }
  await upsertManyConversationIntelligence([
    { ...base, kind: INTEL_KIND_TEMPERATURE, data: { temperature: summary.temperature } },
    { ...base, kind: 'qualification_summary', data: { text: summary.text, suggestedAction: summary.suggestedAction } },
  ])
}

export async function processQualifyJob(job: AutoResponseJob, ctx: QualifyCtx, deps: QualifyDeps): Promise<Outcome> {
  const { settings, conv, lead, master } = ctx
  const doSkip = async (reason: string): Promise<Outcome> => {
    await skipAutoResponseJob(job.id, reason)
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_skipped',
      props: { conversationId: conv.id, reason, mode: 'qualify' },
    })
    return 'skipped'
  }

  // Global backstop (env). Per-agency instant levers are the DB flags.
  if (isQualifierEnabled() === false) return doSkip('qualifier_killed')

  // ── Gather facts (recent transcript drives batch + turn-taking + takeover) ──
  const rows = await db('inbox_messages')
    .where({ conversationId: conv.id })
    .orderBy('sequence', 'desc')
    .limit(MAX_TRANSCRIPT)
    .select('direction', 'text', 'sentByUserId', 'channelTimestamp', 'createdAt', 'metadata')
  const recent = rows.slice().reverse()
  const lastMsg = recent[recent.length - 1]
  const lastInbound = [...recent].reverse().find((m) => m.direction === 'inbound')
  const humanTookOver = recent.some((m) => m.direction === 'outbound' && metaSource(m.metadata) !== 'auto_response')

  const aiState = await getOrCreateAiState(conv.id, job.agencyId)
  const sentToday = await countSentToday(job.agencyId)
  const lastInboundAt = lastInbound ? new Date((lastInbound.channelTimestamp ?? lastInbound.createdAt) as string | Date) : null
  const maxTurns = settings.maxTurns

  const pre = decidePreGeneration({
    aiState: aiState.aiState,
    masterEnabled: master,
    channelEnabled: settings.enabled,
    humanTookOver,
    optOut: detectOptOut(lastInbound?.text ?? ''),
    hasUnansweredInbound: lastMsg?.direction === 'inbound',
    withinQuietHours: withinQuietHours(settings.quietHours, new Date()),
    withinWindow: lastInboundAt ? Date.now() - lastInboundAt.getTime() < WINDOW_MS : false,
    sentTodayForAgency: sentToday,
    dailyCap: settings.dailyCap,
    turnCount: aiState.aiTurnCount,
    maxTurns,
  })
  if (pre.action === 'stop') {
    if (pre.state === 'human_active') await markHumanActive(conv.id)
    else await markStopped(conv.id, 'opted_out', pre.reason)
    return doSkip(pre.reason)
  }
  if (pre.action === 'skip') return doSkip(pre.reason)

  // ── Generate one structured turn ──
  const gen: QualifyGenResult = await deps.generateQualify({
    agencyId: job.agencyId,
    transcript: recent
      .map((m) => ({ direction: m.direction as 'inbound' | 'outbound', text: (m.text as string) ?? '' }))
      .filter((m) => m.text),
    qualification: aiState.qualification,
    collectFields: settings.collectFields,
    guidance: settings.guidance,
  })
  if (gen.ok === false) return doSkip(gen.skipReason)

  const valid = validateAutoResponse(gen.reply).ok
  const merged = mergeQualification(aiState.qualification, gen.extracted)
  const post = decidePostGeneration({
    hotSignal: gen.hotSignal,
    uncertain: gen.uncertain || !valid, // never send an invalid/guessed message — escalate
    requiredComplete: requiredComplete(merged, settings.collectFields.required),
    turnCount: aiState.aiTurnCount,
    maxTurns,
  })
  const lang = detectLang(lastInbound?.text ?? '')
  const draft = settings.draft
  const summary =
    post.action === 'escalate'
      ? buildSummary({ qualification: merged, reason: post.reason, turnCount: aiState.aiTurnCount + 1, lang })
      : null

  // ── Draft/canary: never send; persist + log the would-be output for review ──
  if (draft) {
    const drafted = post.action === 'escalate' ? handoffMessage(post.reason, lang) : gen.reply
    const escalationReason = post.action === 'escalate' ? post.reason : null
    console.log(
      `[IRE-DRAFT] conv=${conv.id} decision=${post.action}:${escalationReason ?? ''} reply=${JSON.stringify(drafted)} extracted=${JSON.stringify(gen.extracted)} qualification=${JSON.stringify(merged)}${summary ? ` summary=${JSON.stringify(summary.text)}` : ''}`,
    )

    try {
      await insertQualifyDraftReview({
        conversationId: conv.id,
        agencyId: job.agencyId,
        decision: post.action,
        escalationReason,
        replyText: drafted,
        extracted: gen.extracted,
        qualification: merged,
        summary,
        lang,
        turnCount: aiState.aiTurnCount + 1,
      })
    } catch (e) {
      console.error(`[IRE-DRAFT] persist failed conv=${conv.id}:`, (e as Error).message)
    }
    await mergeOnly(conv.id, gen.extracted)
    // Shadow-only: mirror the same signal into the runtime World Model (flag-gated, guarded, no-op off).
    await shadowIngestQualification({ agencyId: job.agencyId, leadId: job.leadId, conversationId: conv.id, extracted: gen.extracted })
    // Shadow-only: run the runtime read spine and record the would-be decision (flag-gated, guarded, no-op off).
    await shadowReasonAndDecide({ agencyId: job.agencyId, leadId: job.leadId, conversationId: conv.id, turnCount: aiState.aiTurnCount })
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_draft',
      props: { conversationId: conv.id, decision: post.action },
    })
    return doSkip('draft')
  }

  // ── Escalate: send fixed handoff + mark escalated + persist summary/temperature ──
  if (post.action === 'escalate' && summary) {
    const r = await sendAndPersist(job, ctx, deps.send, handoffMessage(post.reason, lang))
    if (r.ok === false) {
      if (r.reason.startsWith('whatsapp_send_failed')) {
        await failAutoResponseJob(job.id, r.reason)
        return 'failed'
      }
      return doSkip(r.reason)
    }
    await mergeOnly(conv.id, gen.extracted)
    // Shadow-only: mirror the same signal into the runtime World Model (flag-gated, guarded, no-op off).
    await shadowIngestQualification({ agencyId: job.agencyId, leadId: job.leadId, conversationId: conv.id, extracted: gen.extracted })
    // Shadow-only: run the runtime read spine and record the would-be decision (flag-gated, guarded, no-op off).
    await shadowReasonAndDecide({ agencyId: job.agencyId, leadId: job.leadId, conversationId: conv.id, turnCount: aiState.aiTurnCount })
    await markEscalated(conv.id, post.reason)
    await persistEscalation(conv.id, job.agencyId, summary)
    await completeAutoResponseJob(job.id, r.messageId)
    console.log(`[IRE] qualify escalate conv=${conv.id} reason=${post.reason} temp=${summary.temperature} msg=${r.messageId}`)
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_escalated',
      props: { conversationId: conv.id, reason: post.reason },
    })
    return 'sent'
  }

  // ── Continue: send one qualifying reply + advance the turn ──
  const r = await sendAndPersist(job, ctx, deps.send, gen.reply)
  if (r.ok === false) {
    if (r.reason.startsWith('whatsapp_send_failed')) {
      await failAutoResponseJob(job.id, r.reason)
      return 'failed'
    }
    return doSkip(r.reason)
  }
  await recordTurn(conv.id, gen.extracted)
  // Shadow-only: mirror the same signal into the runtime World Model (flag-gated, guarded, no-op off).
  await shadowIngestQualification({ agencyId: job.agencyId, leadId: job.leadId, conversationId: conv.id, extracted: gen.extracted })
  // Shadow-only: run the runtime read spine and record the would-be decision (flag-gated, guarded, no-op off).
  await shadowReasonAndDecide({ agencyId: job.agencyId, leadId: job.leadId, conversationId: conv.id, turnCount: aiState.aiTurnCount + 1 })
  await completeAutoResponseJob(job.id, r.messageId)
  console.log(`[IRE] qualify turn conv=${conv.id} turn=${aiState.aiTurnCount + 1} msg=${r.messageId}`)
  await track({ agencyId: job.agencyId, event: 'auto_response_sent', props: { conversationId: conv.id, reason: 'qualify_turn' } })
  return 'sent'
}
