import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import {
  skipAutoResponseJob,
  completeAutoResponseJob,
  failAutoResponseJob,
  countSentToday,
  skipPendingNoResponseJobs,
  type AutoResponseJob,
} from '@/db/autoResponseJobs'
import type { AutoResponseSettings } from '@/db/autoResponseSettings'
import { getOrCreateAiState, recordTurn, mergeOnly, markEscalated, markHumanActive, markStopped, markClosed } from '@/db/conversationAiState'
import { upsertManyConversationIntelligence, getMaxMessageSequence, INTEL_KIND_TEMPERATURE } from '@/db/conversationIntelligence'
import { insertQualifyDraftReview } from '@/db/qualifyDraftReview'
import { mergeQualification, requiredComplete, isSalesStrategy } from './qualification'
import { decidePreGeneration, decidePostGeneration, isDiscoveryQuestionBudgetExhausted } from './stateMachine'
import {
  generateQualifyTurn,
  handoffMessage,
  detectLang,
  detectOptOut,
  deterministicQualifyFallback,
  cognitionFromUnderstanding,
  inboundMemoryText,
  type QualifyGenResult,
  type RegenerationReason,
} from './qualify'
import { buildSummary, type EscalationSummary } from './summary'
import { isQualifierEnabled } from './killSwitch'
import { isRetryableIreGenerationFailure } from './retryableGeneration'
import { validateAutoResponse, classifyViolation, questionPolicyForSalesMove } from './validate'
import { withinQuietHours } from './worker'
import { shadowIngestQualification } from '@/lib/ai/integration/shadowIngest'
import { shadowReasonAndDecide } from '@/lib/ai/integration/shadowCognition'
import { isWarmHandoffEnabled, buildWarmHandoff } from './warmHandoff'
import { waTrace } from './waTrace'
import { classifySalesTurnFromTranscript, detectHumanRequest, salesMoveUsesProductContract } from './salesIntent'
import {
  allowsOutbound,
  conversationCloser,
  countConsecutiveAiOutbounds,
  decideConversationControl,
  isExplicitReopen,
} from './conversationControl'
import { formatProductKnowledgeBlock, retrieveProductKnowledge } from './productRetrieve'
import { formatBusinessIdentityBlock, loadBusinessIdentity } from './businessIdentity'
import { sendIreOutbound } from './ireSend'
import { runImmediateHumanHandoff } from './immediateHandoff'
import { scheduleNoResponseWarning } from './processNoResponseJob'
import { isNoResponseWarningMessage, metadataKind } from './noResponseClose'

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
const MAX_TRANSCRIPT = 80

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
): Promise<{ ok: true; messageId: number; sequence: number } | { ok: false; reason: string; settled?: true }> {
  return sendIreOutbound(job, ctx, send, text)
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
  const lastOutbound = [...recent].reverse().find((m) => m.direction === 'outbound')
  const humanTookOver = recent.some((m) => m.direction === 'outbound' && metaSource(m.metadata) !== 'auto_response')

  const aiState = await getOrCreateAiState(conv.id, job.agencyId)
  const sentToday = await countSentToday(job.agencyId)
  const lastInboundAt = lastInbound ? new Date((lastInbound.channelTimestamp ?? lastInbound.createdAt) as string | Date) : null
  const maxTurns = settings.maxTurns
  const lastInboundText = (lastInbound?.text as string) ?? ''
  const previousOutbound = (lastOutbound?.text as string | undefined) ?? ''
  const previousOutboundKind = metadataKind(lastOutbound?.metadata)
  const closeOfferPending = isNoResponseWarningMessage(previousOutbound, previousOutboundKind)
  const hasUnansweredInbound = lastMsg?.direction === 'inbound'
  const consecutiveAiWithoutInbound = countConsecutiveAiOutbounds(recent)
  const optOut = detectOptOut(lastInboundText)
  const qTranscript = recent
    .map((m) => ({ direction: m.direction as 'inbound' | 'outbound', text: (m.text as string) ?? '' }))
    .filter((m) => m.text)
  const persistedStrategy = isSalesStrategy(aiState.qualification.cognition?.salesStrategy)
    ? aiState.qualification.cognition?.salesStrategy
    : undefined
  const classified = classifySalesTurnFromTranscript(qTranscript, { salesStrategy: persistedStrategy })
  const salesMove = classified.salesMove
  const salesStrategy = classified.salesStrategy
  const reopenEligible = aiState.aiState === 'closed' && isExplicitReopen({ salesMove, inboundText: lastInboundText })
  const outboundGate = () =>
    allowsOutbound({
      aiState: aiState.aiState,
      hasUnansweredInbound,
      consecutiveAiWithoutInbound,
      humanTookOver,
      optOut,
      reopenEligible,
    })

  const pre = decidePreGeneration({
    aiState: aiState.aiState,
    masterEnabled: master,
    channelEnabled: settings.enabled,
    humanTookOver,
    optOut,
    humanRequest: detectHumanRequest(lastInboundText, { previousOutbound }),
    hasUnansweredInbound,
    withinQuietHours: withinQuietHours(settings.quietHours, new Date()),
    withinWindow: lastInboundAt ? Date.now() - lastInboundAt.getTime() < WINDOW_MS : false,
    sentTodayForAgency: sentToday,
    dailyCap: settings.dailyCap,
    turnCount: aiState.aiTurnCount,
    maxTurns,
    reopenEligible,
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
  if (pre.action === 'skip') return doSkip(pre.reason)
  if (pre.action === 'handoff') {
    const gate = outboundGate()
    if (gate.allowed === false) return doSkip(gate.reason)
    return runImmediateHumanHandoff({
      job,
      ctx,
      send: deps.send,
      aiState,
      lastInboundText,
    })
  }

  const control = decideConversationControl({
    salesMove,
    inboundText: lastInboundText,
    previousOutbound,
    previousOutboundKind,
    closeOfferPending,
  })
  waTrace(
    'CONVERSATION_CONTROL',
    { conversationId: conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
    { action: control.action, reason: 'reason' in control ? control.reason : null, salesMove, closeOfferPending },
  )
  if (control.action === 'HANDOFF_TO_HUMAN') {
    const gate = outboundGate()
    if (gate.allowed === false) return doSkip(gate.reason)
    return runImmediateHumanHandoff({
      job,
      ctx,
      send: deps.send,
      aiState,
      lastInboundText,
    })
  }
  if (control.action === 'CLOSE_CONVERSATION' && control.send === 'silence') {
    await db.transaction((trx) => skipPendingNoResponseJobs(trx, conv.id))
    await markClosed(conv.id, control.reason)
    return doSkip(`closed_${control.reason}`)
  }
  if (control.action === 'CLOSE_CONVERSATION' && control.send === 'closer') {
    const gate = outboundGate()
    if (gate.allowed === false) return doSkip(gate.reason)
    const r = await sendAndPersist(job, ctx, deps.send, conversationCloser(detectLang(lastInboundText)))
    if (r.ok === false) {
      if (r.settled) return 'failed'
      return doSkip(r.reason)
    }
    await db.transaction((trx) => skipPendingNoResponseJobs(trx, conv.id))
    await markClosed(conv.id, control.reason)
    await completeAutoResponseJob(job.id, r.messageId)
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_sent',
      props: { conversationId: conv.id, reason: `closed_${control.reason}` },
    })
    return 'sent'
  }

  // ── Generate one structured turn ──
  // CRM fields stay extracted as memory only. They must not pick the WhatsApp question.
  const discoveryBudgetExhausted = isDiscoveryQuestionBudgetExhausted({
    salesMove,
    turnCount: aiState.aiTurnCount,
    maxTurns,
  })
  const productKnowledge = retrieveProductKnowledge({
    agencyId: job.agencyId,
    inboundText: lastInboundText,
    salesMove,
  })
  const productKnowledgeBlock =
    salesMoveUsesProductContract(salesMove) || salesMove === 'OBJECTION'
      ? formatProductKnowledgeBlock(productKnowledge)
      : null
  const identity = await loadBusinessIdentity(job.agencyId, job.channel)
  const businessIdentityBlock = formatBusinessIdentityBlock(identity)
  const questionPolicy = questionPolicyForSalesMove(salesMove, { discoveryBudgetExhausted })
  const genTrace = { conversationId: conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence }
  waTrace('GENERATE_QUALIFY_START', genTrace, {
    transcriptLength: qTranscript.length,
    currentQualification: aiState.qualification,
    aiTurnCount: aiState.aiTurnCount,
    salesMove,
    salesStrategy,
  })
  const genArgs = {
    agencyId: job.agencyId,
    transcript: qTranscript,
    qualification: aiState.qualification,
    collectFields: settings.collectFields,
    guidance: settings.guidance,
    salesMove,
    salesStrategy,
    productKnowledgeBlock,
    businessIdentityBlock,
    discoveryBudgetExhausted,
    trace: genTrace,
  }
  const gen: QualifyGenResult = await deps.generateQualify(genArgs)
  if (gen.ok === false) {
    if (isRetryableIreGenerationFailure(gen.skipReason)) {
      await failAutoResponseJob(job.id, gen.skipReason)
      return 'failed'
    }
    return doSkip(gen.skipReason)
  }

  const lang = detectLang(lastInbound?.text ?? '')

  // ── Validate the reply; resolve shape/safety violations BEFORE the policy ──
  // A validation failure is NOT model uncertainty. Shape → one stricter
  // regeneration, else a strategy-aware fallback question (never a handoff).
  // Safety → regenerate once, then escalate ('guardrail'). `uncertain` fed to
  // the policy below is model-only.
  let validation = validateAutoResponse(gen.reply, { questionPolicy })
  let forcedGuardrail = false
  if (!validation.ok) {
    const originalViolation = 'violation' in validation ? validation.violation : 'invalid'
    const regenerationReason: RegenerationReason =
      classifyViolation(originalViolation) === 'safety' ? 'safety_validation' : 'shape_validation'
    const gen2 = await deps.generateQualify({ ...genArgs, regenerationReason })
    const gen2Valid = gen2.ok === false ? null : validateAutoResponse(gen2.reply, { questionPolicy })
    let finalResolution: 'regenerated' | 'deterministic' | 'guardrail_handoff'
    let validationResult: string
    if (gen2.ok !== false && gen2Valid && gen2Valid.ok) {
      // Repair may rewrite the reply and refresh extracted facts. It must not
      // mutate escalation policy: classifier salesMove stays the authority,
      // and gen2 hotSignal/salesMove are ignored.
      gen.reply = gen2.reply
      gen.extracted = gen2.extracted
      gen.uncertain = gen2.uncertain
      gen.objective = gen2.objective
      gen.understanding = gen2.understanding
      validation = gen2Valid
      finalResolution = 'regenerated'
      validationResult = 'ok'
    } else {
      const finalViolation = gen2Valid && 'violation' in gen2Valid ? gen2Valid.violation : originalViolation
      validationResult = gen2.ok === false ? 'regeneration_unavailable' : finalViolation
      if (classifyViolation(finalViolation) === 'safety') {
        // Safety breach survived one regeneration → hand off (never send it).
        forcedGuardrail = true
        finalResolution = 'guardrail_handoff'
      } else {
        // Shape breach survived → objective-aware fallback; stay in qualify.
        // Never rewrite a valid AI reply; this path is only for unsendable text.
        const incomingCog = cognitionFromUnderstanding(
          gen.understanding,
          gen.objective,
          inboundMemoryText({
            qualification: aiState.qualification,
            lastInboundText,
            transcript: qTranscript,
          }),
          salesStrategy,
        )
        const mergedNow = mergeQualification(aiState.qualification, { ...gen.extracted, cognition: incomingCog })
        gen.reply = deterministicQualifyFallback({
          qualification: mergedNow,
          lastInboundText,
          transcript: qTranscript,
          cognition: mergedNow.cognition,
          objective: gen.objective,
          salesMove,
          salesStrategy,
          discoveryBudgetExhausted,
          lang,
        })
        validation = validateAutoResponse(gen.reply, { questionPolicy })
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

  const incomingCog = cognitionFromUnderstanding(
    gen.understanding,
    gen.objective,
    inboundMemoryText({
      qualification: aiState.qualification,
      lastInboundText,
      transcript: qTranscript,
    }),
    salesStrategy,
  )
  const persistExtracted = { ...gen.extracted, cognition: incomingCog }
  const merged = mergeQualification(aiState.qualification, persistExtracted)
  let post = decidePostGeneration({
    hotSignal: gen.hotSignal, // observability only — policy ignores LLM hotness
    uncertain: gen.uncertain, // model-only; validation failures are resolved above
    requiredComplete: requiredComplete(merged, settings.collectFields.required),
    turnCount: aiState.aiTurnCount,
    maxTurns,
    salesMove, // classifier only; LLM salesMove is never policy
  })
  // Safety-guardrail handoff wins over any send/continue decision.
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
    await mergeOnly(conv.id, persistExtracted)
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
      const warm = buildWarmHandoff({
        name: merged.name,
        need: merged.need,
        urgency: merged.urgency,
        context: qTranscript.find((m) => m.direction === 'inbound')?.text,
        lang,
      })
      waTrace('WARM_HANDOFF', genTrace, { ...warm.telemetry })
      if (warm.text) handoffText = warm.text
    }
    const gate = outboundGate()
    if (gate.allowed === false) return doSkip(gate.reason)
    const r = await sendAndPersist(job, ctx, deps.send, handoffText)
    if (r.ok === false) {
      if (r.settled) return 'failed'
      return doSkip(r.reason)
    }
    await mergeOnly(conv.id, persistExtracted)
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
  const continueGate = outboundGate()
  if (continueGate.allowed === false) return doSkip(continueGate.reason)
  const r = await sendAndPersist(job, ctx, deps.send, gen.reply)
  if (r.ok === false) {
    if (r.settled) return 'failed'
    return doSkip(r.reason)
  }
  await recordTurn(conv.id, persistExtracted)
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
  await scheduleNoResponseWarning({
    agencyId: job.agencyId,
    conversationId: conv.id,
    leadId: job.leadId,
    channel: job.channel,
    triggerSequence: r.sequence,
  })
  console.log(`[IRE] qualify turn conv=${conv.id} turn=${aiState.aiTurnCount + 1} msg=${r.messageId}`)
  await track({ agencyId: job.agencyId, event: 'auto_response_sent', props: { conversationId: conv.id, reason: 'qualify_turn' } })
  return 'sent'
}
