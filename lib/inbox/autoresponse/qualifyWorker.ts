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
import {
  generateQualifyTurn,
  handoffMessage,
  detectLang,
  detectOptOut,
  detectHumanRequest,
  nextRequiredFieldQuestion,
  type QualifyGenResult,
  type RegenerationReason,
} from './qualify'
import { buildSummary, type EscalationSummary } from './summary'
import { isQualifierEnabled } from './killSwitch'
import { validateAutoResponse, classifyViolation } from './validate'
import { withinQuietHours } from './worker'
import { shadowIngestQualification } from '@/lib/ai/integration/shadowIngest'
import { shadowReasonAndDecide } from '@/lib/ai/integration/shadowCognition'
import {
  getRuntimeCognitionForLead,
  formatRuntimeCognitionBlock,
  type RuntimeCognition,
} from '@/lib/copilot/general/runtimeCognition'
import { isRuntimeQualificationEnabled, selectNextGap, decideConversationPolicy } from './runtimeQualification'
import { isPostHandoffEnabled, respondPostHandoff, generatePostHandoffReply } from './postHandoff'
import { isWarmHandoffEnabled, buildWarmHandoff } from './warmHandoff'
import { waTrace } from './waTrace'

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

  const sent = await send({
    phoneNumberId: ctx.conv.businessPhoneNumberId,
    accessToken: connection.access_token,
    to,
    body: text,
    trace: { conversationId: ctx.conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
  })
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
  waTrace(
    'PRE_GENERATION_DECISION',
    { conversationId: conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
    { action: pre.action, reason: 'reason' in pre ? pre.reason : null },
  )
  if (pre.action === 'stop') {
    if (pre.state === 'human_active') await markHumanActive(conv.id)
    else await markStopped(conv.id, 'opted_out', pre.reason)
    return doSkip(pre.reason)
  }
  // ── Post-handoff responder (flag-gated, additive). Once handed off, a human
  //    reply already short-circuits above (humanTookOver → human_active). Here,
  //    if the customer keeps writing after handoff and the responder is enabled,
  //    reply briefly (ack / answer-from-guidance / defer) up to the budget, then
  //    go silent — never re-qualifying. Off/other → the legacy skip as today. ──
  if (pre.action === 'skip' && pre.reason === 'already_escalated' && isPostHandoffEnabled(job.agencyId)) {
    const budgetRow = await db('inbox_messages')
      .where({ conversationId: conv.id, direction: 'outbound' })
      .whereRaw(`metadata->>'reason' = 'post_handoff'`)
      .count<{ c: string }[]>({ c: '*' })
      .first()
    const budgetUsed = Number(budgetRow?.c ?? 0)
    return respondPostHandoff({
      job,
      ctx,
      deps: { send: deps.send, generate: generatePostHandoffReply },
      recent: recent
        .map((m) => ({ direction: m.direction as 'inbound' | 'outbound', text: (m.text as string) ?? '' }))
        .filter((m) => m.text),
      lastInbound: lastInbound ? { text: (lastInbound.text as string) ?? '' } : undefined,
      guidance: settings.guidance,
      sentToday,
      dailyCap: settings.dailyCap,
      withinQuietHours: withinQuietHours(settings.quietHours, new Date()),
      withinWindow: lastInboundAt ? Date.now() - lastInboundAt.getTime() < WINDOW_MS : false,
      hasUnansweredInbound: lastMsg?.direction === 'inbound',
      budgetUsed,
    })
  }
  if (pre.action === 'skip') return doSkip(pre.reason)

  // ── Runtime-aware qualification (flag-gated, guarded). The Runtime supplies
  //    cognition (confidence/uncertainty/provenance) and informs the handoff;
  //    configuration owns the required fields and their priority; this engine
  //    only orchestrates. Off/error → the qualifier behaves exactly as today. ──
  const rqEnabled = isRuntimeQualificationEnabled(job.agencyId)
  let rqCognition: RuntimeCognition | null = null
  let rqFocusField: string | null = null
  let rqCognitionBlock: string | null = null
  if (rqEnabled) {
    try {
      rqCognition = await getRuntimeCognitionForLead({ agencyId: job.agencyId }, job.leadId)
      rqCognitionBlock = formatRuntimeCognitionBlock(rqCognition)
      rqFocusField = selectNextGap(aiState.qualification, settings.collectFields.required)
    } catch {
      // guarded — Runtime cognition is additive; never affect the qualifier
    }
  }

  // ── Generate one structured turn ──
  const qTranscript = recent
    .map((m) => ({ direction: m.direction as 'inbound' | 'outbound', text: (m.text as string) ?? '' }))
    .filter((m) => m.text)
  const genTrace = { conversationId: conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence }
  waTrace('GENERATE_QUALIFY_START', genTrace, {
    transcriptLength: qTranscript.length,
    currentQualification: aiState.qualification,
    aiTurnCount: aiState.aiTurnCount,
  })
  const genArgs = {
    agencyId: job.agencyId,
    transcript: qTranscript,
    qualification: aiState.qualification,
    collectFields: settings.collectFields,
    guidance: settings.guidance,
    focusField: rqFocusField,
    runtimeCognition: rqCognitionBlock,
    trace: genTrace,
  }
  const gen: QualifyGenResult = await deps.generateQualify(genArgs)
  if (gen.ok === false) return doSkip(gen.skipReason)

  const lang = detectLang(lastInbound?.text ?? '')

  // ── Validate the reply; resolve shape/safety violations BEFORE the policy ──
  // A validation failure is NOT model uncertainty. Shape → one stricter
  // regeneration, else a deterministic next-field question (never a handoff).
  // Safety → regenerate once, then escalate ('guardrail'). FORBIDDEN and Runtime
  // Qualification are unchanged; `uncertain` fed to the policy below is model-only.
  let validation = validateAutoResponse(gen.reply)
  let forcedGuardrail = false
  if (!validation.ok) {
    const originalViolation = 'violation' in validation ? validation.violation : 'invalid'
    const regenerationReason: RegenerationReason =
      classifyViolation(originalViolation) === 'safety' ? 'safety_validation' : 'shape_validation'
    const gen2 = await deps.generateQualify({ ...genArgs, regenerationReason })
    const gen2Valid = gen2.ok === false ? null : validateAutoResponse(gen2.reply)
    let finalResolution: 'regenerated' | 'deterministic' | 'guardrail_handoff'
    let validationResult: string
    if (gen2.ok !== false && gen2Valid && gen2Valid.ok) {
      // Second generation is valid → use it (adopt its reply, extraction, flags).
      gen.reply = gen2.reply
      gen.extracted = gen2.extracted
      gen.hotSignal = gen2.hotSignal
      gen.uncertain = gen2.uncertain
      validation = gen2Valid
      finalResolution = 'regenerated'
      validationResult = 'ok'
    } else {
      const finalViolation =
        gen2Valid && 'violation' in gen2Valid ? gen2Valid.violation : originalViolation
      validationResult = gen2.ok === false ? 'regeneration_unavailable' : finalViolation
      if (classifyViolation(finalViolation) === 'safety') {
        // Safety breach survived one regeneration → hand off (never send it).
        forcedGuardrail = true
        finalResolution = 'guardrail_handoff'
      } else {
        // Shape breach survived → deterministic next-field question; stay in qualify.
        const mergedNow = mergeQualification(aiState.qualification, gen.extracted) as Record<string, unknown>
        const missingRequired = settings.collectFields.required.filter((f) => !mergedNow[f])
        gen.reply = nextRequiredFieldQuestion(missingRequired, lang)
        validation = validateAutoResponse(gen.reply)
        finalResolution = 'deterministic'
      }
    }
    waTrace('POST_GENERATION_REPAIR', genTrace, {
      regenerationReason,
      originalViolation,
      regenerationAttempt: 1,
      validationResult,
      finalResolution,
    })
  }

  const merged = mergeQualification(aiState.qualification, gen.extracted)
  let post = decidePostGeneration({
    hotSignal: gen.hotSignal,
    uncertain: gen.uncertain, // model-only; validation failures are resolved above
    requiredComplete: requiredComplete(merged, settings.collectFields.required),
    turnCount: aiState.aiTurnCount,
    maxTurns,
  })
  // Conversation decision policy (flag-gated). Replaces the rigid hotSignal/
  // requiredComplete auto-handoff with ONE reasoned ASK/HANDOFF decision, while
  // hard escalations (uncertain / max_turns) stay untouched. Flag off → the
  // legacy decidePostGeneration result governs exactly as today.
  if (rqEnabled) {
    if (detectHumanRequest(lastInbound?.text ?? '')) {
      // Hard rule: an explicit request for a person bypasses reasoning entirely.
      post = { action: 'escalate', reason: 'human_request' }
    } else if (
      post.action === 'send' ||
      (post.action === 'escalate' && (post.reason === 'hot_signal' || post.reason === 'qualified'))
    ) {
      // The single reasoned decision governs the soft cases. It consumes the
      // Runtime's open questions (what is worth asking) + the config fields; it
      // decides only whether to ask one more. Reuses the existing send / escalate
      // paths — ASK sends the already-generated gen.reply, HANDOFF escalates.
      const decision = decideConversationPolicy({
        qualification: merged,
        required: settings.collectFields.required,
        turnCount: aiState.aiTurnCount,
        maxTurns,
      })
      console.log(`[IRE-RQ] conv=${conv.id} policy=${decision.decision} gap=${decision.gap ?? '-'} reason=${decision.reason}`)
      post = decision.decision === 'ASK' ? { action: 'send' } : { action: 'escalate', reason: 'qualified' }
    }
  }
  // Safety-guardrail handoff wins over any send/continue decision. RQ already
  // excluded it ('guardrail' is neither 'send' nor a completion reason), so this
  // is the single authoritative override.
  if (forcedGuardrail) post = { action: 'escalate', reason: 'guardrail' }

  // Permanent validator telemetry (observability only — no logic change). Records
  // the exact generated reply, its normalized form, the validator's rule/violation/
  // diagnostics, and the final send-vs-escalate decision.
  waTrace('POST_GENERATION_VALIDATION', genTrace, {
    reply: gen.reply,
    normalizedReply: (gen.reply ?? '').trim(),
    validation: {
      ok: validation.ok,
      violation: 'violation' in validation ? validation.violation : null,
      rule: 'violation' in validation ? validation.violation : null,
      details: validation.details,
    },
    decision: post.action,
  })

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
    // TEMPORARY (P2.5 canary): persist the draft so it is reviewable, not just logged.
    // Write-only observability — wrapped so a failure can never break send-suppression.
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
    await shadowIngestQualification({
      agencyId: job.agencyId,
      leadId: job.leadId,
      conversationId: conv.id,
      extracted: gen.extracted,
    })
    // Shadow-only: run the runtime read spine and record the would-be decision (flag-gated, guarded, no-op off).
    await shadowReasonAndDecide({
      agencyId: job.agencyId,
      leadId: job.leadId,
      conversationId: conv.id,
      turnCount: aiState.aiTurnCount,
    })
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_draft',
      props: { conversationId: conv.id, decision: post.action },
    })
    return doSkip('draft')
  }

  // ── Escalate: send handoff + mark escalated + persist summary/temperature.
  //    On a QUALIFIED handoff only, an enabled agency gets a deterministic warm
  //    message assembled from known fields; any fallback → the fixed template. ──
  if (post.action === 'escalate' && summary) {
    let handoffText = handoffMessage(post.reason, lang)
    if (post.reason === 'qualified' && isWarmHandoffEnabled(job.agencyId)) {
      const warm = buildWarmHandoff({ name: merged.name, need: merged.need, urgency: merged.urgency, lang })
      waTrace('WARM_HANDOFF', genTrace, { ...warm.telemetry })
      if (warm.text) handoffText = warm.text
    }
    const r = await sendAndPersist(job, ctx, deps.send, handoffText)
    if (r.ok === false) {
      if (r.reason.startsWith('whatsapp_send_failed')) {
        await failAutoResponseJob(job.id, r.reason)
        return 'failed'
      }
      return doSkip(r.reason)
    }
    await mergeOnly(conv.id, gen.extracted)
    // Shadow-only: mirror the same signal into the runtime World Model (flag-gated, guarded, no-op off).
    await shadowIngestQualification({
      agencyId: job.agencyId,
      leadId: job.leadId,
      conversationId: conv.id,
      extracted: gen.extracted,
    })
    // Shadow-only: run the runtime read spine and record the would-be decision (flag-gated, guarded, no-op off).
    await shadowReasonAndDecide({
      agencyId: job.agencyId,
      leadId: job.leadId,
      conversationId: conv.id,
      turnCount: aiState.aiTurnCount,
    })
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
  await shadowIngestQualification({
    agencyId: job.agencyId,
    leadId: job.leadId,
    conversationId: conv.id,
    extracted: gen.extracted,
  })
  // Shadow-only: run the runtime read spine and record the would-be decision (flag-gated, guarded, no-op off).
  await shadowReasonAndDecide({
    agencyId: job.agencyId,
    leadId: job.leadId,
    conversationId: conv.id,
    turnCount: aiState.aiTurnCount + 1,
  })
  await completeAutoResponseJob(job.id, r.messageId)
  console.log(`[IRE] qualify turn conv=${conv.id} turn=${aiState.aiTurnCount + 1} msg=${r.messageId}`)
  await track({ agencyId: job.agencyId, event: 'auto_response_sent', props: { conversationId: conv.id, reason: 'qualify_turn' } })
  return 'sent'
}
