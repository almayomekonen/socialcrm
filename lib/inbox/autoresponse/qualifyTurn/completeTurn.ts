/**
 * Completing a qualify turn after generation.
 *
 * Part of the qualify turn (../qualifyWorker.ts), moved out unchanged so the
 * orchestrator stays reviewable (architecture-rules §1, §5). Behaviour-preserving:
 * the statements are the original ones, in the original order.
 */
import { track } from '@/lib/analytics/track'
import { completeAutoResponseJob } from '@/db/autoResponseJobs'
import { recordTurn, mergeOnly, markEscalated, reopenClosedConversation } from '@/db/conversationAiState'
import { insertQualifyDraftReview } from '@/db/qualifyDraftReview'
import { recordTurnClassification } from '@/db/conversationTurnClassification'
import { isPositiveLeadId } from '../contactJob'
import { mergeQualification, requiredComplete } from '../qualification'
import { decidePostGeneration } from '../stateMachine'
import { handoffMessage, cognitionFromUnderstanding, inboundMemoryText } from '../qualify'
import { buildSummary } from '../summary'
import { isWarmHandoffEnabled, buildWarmHandoff } from '../warmHandoff'
import { waTrace } from '../waTrace'
import { withGreeting } from '../greeting'
import { scheduleNoResponseWarning } from '../processNoResponseJob'
import { memoryAfterTurn, modeOf, notifyPersonalConversation } from '../conversational/hooks'
import { isSocialMode } from '../conversational/mode'
import { meetingNeedsTeam } from '../conversational/turnRules'
import type { GeneratedTurn, GenerationInput, Outcome, TurnBase, TurnFacts } from './types'
import { persistEscalation, sendAndPersist, shadowQualificationIfLead } from './effects'

/** Post-generation: the decision, the classification log, and the draft / escalate / continue paths. */
export async function completeQualifyTurn(t: TurnBase & TurnFacts & GenerationInput & GeneratedTurn & { deferredMeeting: boolean }): Promise<Outcome> {
  const { job, ctx, deps, doSkip, reliability, aiState, convo, maxTurns, lastInboundText, qTranscript, salesMove, salesStrategy, reopenEligible, outboundGate, lang, responseProfile, identity, greetingLine, genTrace, gen, validation, forcedGuardrail, schedulingOverride, deferredMeeting } = t
  const { settings, conv } = ctx
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
  const draftOnly = settings.draft
  const turnMemory = convo ? memoryAfterTurn(convo, gen, { willSend: !draftOnly }) : null
  const persistExtracted = { ...gen.extracted, cognition: incomingCog, ...(turnMemory ? { conversation: turnMemory.memory } : {}) }
  const merged = mergeQualification(aiState.qualification, persistExtracted, { corrected: gen.corrected })
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
  else if (convo) {
    // A deferred meeting mention: the team gets a new booking need; everyone else gets the reply.
    if (deferredMeeting && post.action === 'escalate' && post.reason === 'human_request' && !meetingNeedsTeam(modeOf(gen))) {
      post = { action: 'send' }
    }
    // The model called a scheduling request personal: the team handles it, as a meeting request always was.
    if (schedulingOverride) post = { action: 'escalate', reason: 'scheduling_request' }
    // A topic the owner asked a person to handle (owner-configured only).
    if (gen.escalationTopic && (identity.agentProfile?.escalationTopics.length ?? 0) > 0) {
      post = { action: 'escalate', reason: 'escalation_topic' }
    }
  }
  if (convo) {
    waTrace('CONVERSATIONAL_TURN', genTrace, {
      mode: modeOf(gen),
      confidence: gen.modeConfidence ?? null,
      relationship: convo.crm.relationship,
      socialHint: convo.socialHint,
      schedulingOverride,
      decision: post.action,
    })
  }

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

  // ── Classification log: exactly one row per customer turn, covering all three
  //    outcomes below. It sits here because every classification field is final at
  //    this point and none of the branches change them, while the early exits above
  //    have no responseProfile or hotSignal to record. Guarded like the draft-review
  //    write: observability must never break a customer message.
  try {
    await recordTurnClassification({
      job,
      salesMove,
      salesStrategy,
      responseProfile,
      hotSignal: gen.hotSignal,
      uncertain: gen.uncertain,
      decision: post,
      draft,
      turnCount: aiState.aiTurnCount + 1,
      model: gen.model,
    })
  } catch (e) {
    console.error(`[IRE-CLASSIFY] persist failed conv=${conv.id}:`, (e as Error).message)
  }

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
    await mergeOnly(conv.id, persistExtracted, gen.corrected)
    await shadowQualificationIfLead(job, conv.id, gen.extracted, aiState.aiTurnCount)
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
    const r = await sendAndPersist(job, ctx, deps.send, withGreeting(greetingLine, handoffText))
    if (r.ok === false) {
      if (r.settled) return 'failed'
      return doSkip(r.reason)
    }
    await mergeOnly(conv.id, persistExtracted, gen.corrected)
    await shadowQualificationIfLead(job, conv.id, gen.extracted, aiState.aiTurnCount)
    await markEscalated(conv.id, post.reason)
    await persistEscalation(conv.id, job.agencyId, summary, merged)
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
  await recordTurn(conv.id, persistExtracted, gen.corrected)
  // A legitimately reopened conversation is the agent's again, instead of
  // staying `closed` and needing every later message to re-qualify as a reopen.
  if (reliability && aiState.aiState === 'closed' && reopenEligible) await reopenClosedConversation(conv.id)
  await shadowQualificationIfLead(job, conv.id, gen.extracted, aiState.aiTurnCount + 1)
  await completeAutoResponseJob(job.id, r.messageId)
  // A friend is never asked "are you still there?".
  if (isPositiveLeadId(job.leadId) && !(convo && isSocialMode(modeOf(gen)))) {
    await scheduleNoResponseWarning({
      agencyId: job.agencyId,
      conversationId: conv.id,
      leadId: job.leadId,
      channel: job.channel,
      triggerSequence: r.sequence,
    })
  }
  if (turnMemory?.notify) {
    await notifyPersonalConversation({ agencyId: job.agencyId, conversationId: conv.id, leadId: isPositiveLeadId(job.leadId) ? job.leadId : null, customerName: conv.customerName })
  }
  console.log(`[IRE] qualify turn conv=${conv.id} turn=${aiState.aiTurnCount + 1} msg=${r.messageId}`)
  await track({
    agencyId: job.agencyId,
    event: 'auto_response_sent',
    props: { conversationId: conv.id, reason: 'qualify_turn', ...(convo ? { conversationMode: modeOf(gen) } : {}) },
  })
  return 'sent'
}
