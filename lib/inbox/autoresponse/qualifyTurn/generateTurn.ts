/**
 * Preparing and running the qualify turn's generation.
 *
 * Part of the qualify turn (../qualifyWorker.ts), moved out unchanged so the
 * orchestrator stays reviewable (architecture-rules §1, §5). Behaviour-preserving:
 * the statements are the original ones, in the original order.
 *
 * NOTE (architecture-rules §6): ~310 lines, over the 250 soft limit on purpose.
 * It is two linear steps of ONE concern (prepare the model call, run it with its
 * validation and single repair); splitting them further would pass a dozen locals
 * between micro-files for no readability gain.
 */
import { failAutoResponseJob } from '@/db/autoResponseJobs'
import { mergeQualification } from '../qualification'
import { isDiscoveryQuestionBudgetExhausted } from '../stateMachine'
import { deterministicQualifyFallback, cognitionFromUnderstanding, inboundMemoryText, type QualifyGenResult, type RegenerationReason } from '../qualify'
import { isRetryableIreGenerationFailure } from '../retryableGeneration'
import { validateAutoResponse, classifyViolation, questionPolicyForSalesMove } from '../validate'
import { waTrace } from '../waTrace'
import { shouldInvokeSalesAi } from '../gptEligibility'
import { classifyResponseProfile } from '../responseProfile'
import { salesMoveUsesProductContract } from '../salesIntent'
import { inboundContainsRealQuestion, outboundOffersHandoff } from '../conversationControl'
import { formatProductKnowledgeBlock, retrieveProductKnowledge } from '../productRetrieve'
import { formatBusinessIdentityBlock, groundedFactsFor } from '../businessIdentity'
import { formatSummaryBlock, planSummary, summariseConversation } from '../conversationSummary'
import { saveConversationSummary } from '@/db/conversationAiState'
import { withGreeting } from '../greeting'
import { watchHumanPresence } from '../humanPresenceWatch'
import { checkConversationalReply, discoveryTurnCount, modeOf, promptContextFor } from '../conversational/hooks'
import { isSocialMode } from '../conversational/mode'
import { isSchedulingRequest } from '../conversational/turnRules'
import type { GenerationInput, TurnBase, TurnFacts, TurnResponders } from './types'

/** Response profile, discovery budget, product knowledge, greeting, rolling summary, and the model arguments. */
export async function prepareGeneration(t: TurnBase & TurnFacts & TurnResponders & { gptEligibility: ReturnType<typeof shouldInvokeSalesAi>; inboundTexts: string[] }) {
  const { job, recent, lastInbound, aiState, convo, maxTurns, lastInboundText, previousOutbound, sequencedTurns, qTranscript, salesMove, salesStrategy, gptEligibility, inboundTexts, resolveGreeting } = t
  const { settings, conv } = t.ctx
  const responseProfile = classifyResponseProfile({
    lastInbound: lastInboundText,
    recentCustomerTexts: inboundTexts.slice(-3),
  })

  // ── Generate one structured turn ──
  // CRM fields stay extracted as memory only. They must not pick the WhatsApp question.
  const discoveryBudgetExhausted = isDiscoveryQuestionBudgetExhausted({
    salesMove,
    turnCount: discoveryTurnCount(convo, aiState.aiTurnCount),
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
  const genTraceCtx = () => ({
    conversationId: conv.id,
    jobId: job.id,
    agencyId: job.agencyId,
    triggerSequence: job.triggerSequence,
  })
  const { identity, line: templateGreetingLine } = await resolveGreeting()
  // Conversational: the owner's own greeting when set, and no welcome for an existing customer.
  const greetingLine =
    convo && templateGreetingLine
      ? convo.crm.relationship === 'existing_customer'
        ? null
        : (identity.agentProfile?.greeting ?? templateGreetingLine)
      : templateGreetingLine
  const businessIdentityBlock = formatBusinessIdentityBlock(identity)

  // ── Rolling summary ────────────────────────────────────────────────────────
  // Only moves when the recent-message window actually rolled past unsummarised
  // messages, so an ordinary turn costs nothing extra. A failure here is logged
  // and dropped: memory is worth a model call, never worth losing the reply.
  let conversationSummary = aiState.summary
  const summaryPlan = planSummary(sequencedTurns, {
    summary: aiState.summary,
    summaryThroughSequence: aiState.summaryThroughSequence,
  })
  if (summaryPlan.action === 'summarise') {
    try {
      const summarised = await summariseConversation({
        agencyId: job.agencyId,
        previousSummary: aiState.summary,
        olderTurns: summaryPlan.olderTurns,
        upToSequence: summaryPlan.upToSequence,
      })
      if (summarised.ok) {
        conversationSummary = summarised.summary
        await (t.deps.persistSummary ?? saveConversationSummary)(conv.id, summarised.summary, summarised.throughSequence)
        waTrace('CONVERSATION_SUMMARISED', genTraceCtx(), {
          throughSequence: summarised.throughSequence,
          summarisedTurns: summaryPlan.olderTurns.length,
          length: summarised.summary.length,
        })
      } else {
        waTrace('CONVERSATION_SUMMARISED', genTraceCtx(), { ok: false, reason: 'reason' in summarised ? summarised.reason : null })
      }
    } catch (summaryErr) {
      console.error('[IRE] summary failed', { conversationId: conv.id, reason: (summaryErr as Error)?.message })
    }
  }
  const summaryBlock = formatSummaryBlock(conversationSummary)

  const questionPolicy = questionPolicyForSalesMove(salesMove, {
    discoveryBudgetExhausted,
    inboundWasQuestion: inboundContainsRealQuestion(lastInboundText),
  })
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
    responseProfile,
    greetingLine,
    summaryBlock,
    /**
     * The customer supplied content in a conversation we are already in.
     *
     * Covers ENGAGED_CONTENT as well as ANSWERS_OPEN_QUESTION, because the agent
     * does not reliably end its request with a question mark: in a real-model
     * replay it wrote "כדי להתקדם, כתבו לי מספר טלפון…", so the reply came back
     * as ENGAGED_CONTENT, the narrower flag never fired, and the model
     * re-explained the product to someone who had just answered it. Re-pitching
     * is wrong on either turn, so the directive applies to both.
     */
    answeringOurRequest:
      gptEligibility.reason === 'ANSWERS_OPEN_QUESTION' || gptEligibility.reason === 'ENGAGED_CONTENT',
    handoffAlreadyOffered: outboundOffersHandoff(previousOutbound),
    ...(convo ? { conversational: promptContextFor(convo) } : {}),
  }
  return { responseProfile, discoveryBudgetExhausted, identity, greetingLine, questionPolicy, genTrace, genArgs }
}

/**
 * The model call, validation, the one repair, and the conversational truthfulness check.
 * `{ done }` is an outcome the orchestrator returns as is (skip or failed).
 */
export async function generateValidatedTurn(t: TurnBase & TurnFacts & GenerationInput) {
  const { job, deps, doSkip, aiState, convo, lastInboundText, qTranscript, salesMove, salesStrategy, lang, discoveryBudgetExhausted, identity, greetingLine, questionPolicy, genTrace, genArgs } = t
  const { conv } = t.ctx
  // ── Cancel-on-presence: abandon the model call the moment a rep starts typing.
  // Best effort only. Whatever happens here, the outbound guard re-checks.
  const presenceWatch = (deps.watchPresence ?? watchHumanPresence)({
    conversationId: conv.id,
    turnStartedAt: job.createdAt,
    trace: genTrace,
  })
  const gen: QualifyGenResult = await deps.generateQualify({ ...genArgs, abortSignal: presenceWatch.signal })
  if (gen.ok === false) {
    presenceWatch.stop()
    // An abort is not a provider outage: retrying it would burn the job's
    // attempts and eventually deliver the reply the human displaced.
    if (presenceWatch.cancelled()) return { done: await doSkip('human_typing') }
    if (isRetryableIreGenerationFailure(gen.skipReason)) {
      await (deps.failJob ?? failAutoResponseJob)(job.id, gen.skipReason, job.ownerWorkerId)
      return { done: 'failed' as const }
    }
    return { done: await doSkip(gen.skipReason) }
  }
  if (presenceWatch.cancelled()) {
    // The model won the race with the abort. The reply is discarded, not sent.
    presenceWatch.stop()
    return { done: await doSkip('human_typing') }
  }
  // A booking / change / availability request is business whatever the model read: it goes to the team.
  const schedulingOverride = !!convo && modeOf(gen) === 'personal' && isSchedulingRequest(lastInboundText)
  if (schedulingOverride) gen.conversationMode = 'scheduling'

  // ── Validate the reply; resolve shape/safety violations BEFORE the policy ──
  // A validation failure is NOT model uncertainty. Shape → one stricter
  // regeneration, else a strategy-aware fallback question (never a handoff).
  // Safety → regenerate once, then escalate ('guardrail'). `uncertain` fed to
  // the policy below is model-only.
  // `groundedFacts` is what makes a price figure or a process claim checkable:
  // the validator allows one only when it appears in this business's own saved
  // information. Agent instructions are included because an owner may state a
  // real figure there ("consultation is 200").
  const validateOpts = {
    // A friend's reply needs no question; the conversational prompt decides when one helps.
    questionPolicy: convo ? ('zero_or_one' as const) : questionPolicy,
    greetingTurn: Boolean(greetingLine),
    groundedFacts: groundedFactsFor(identity),
    ...(convo ? { conversational: { greetingLine } } : {}),
  }
  // The model asked for a person (booking, moving, cancelling, availability): the real
  // handoff runs in completeTurn and its fixed copy is sent, so this text is never sent
  // and is not repaired.
  const handoffRequested = !!convo && gen.needsTeam === true && !isSocialMode(modeOf(gen))
  let validation = validateAutoResponse(gen.reply, validateOpts)
  let forcedGuardrail = false
  if (!validation.ok && !handoffRequested) {
    const originalViolation = 'violation' in validation ? validation.violation : 'invalid'
    const regenerationReason: RegenerationReason =
      classifyViolation(originalViolation) === 'safety' ? 'safety_validation' : 'shape_validation'
    const gen2 = await deps.generateQualify({ ...genArgs, regenerationReason, abortSignal: presenceWatch.signal })
    const gen2Valid = gen2.ok === false ? null : validateAutoResponse(gen2.reply, validateOpts)
    let finalResolution: 'regenerated' | 'deterministic' | 'guardrail_handoff'
    let validationResult: string
    if (gen2.ok !== false && gen2Valid && gen2Valid.ok) {
      // Repair may rewrite the reply and refresh extracted facts. It must not
      // mutate escalation policy: classifier salesMove stays the authority,
      // and gen2 hotSignal/salesMove are ignored.
      gen.reply = gen2.reply
      gen.extracted = gen2.extracted
      gen.corrected = gen2.corrected
      gen.uncertain = gen2.uncertain
      gen.objective = gen2.objective
      gen.understanding = gen2.understanding
      validation = gen2Valid
      finalResolution = 'regenerated'
      validationResult = 'ok'
    } else {
      const finalViolation = gen2Valid && 'violation' in gen2Valid ? gen2Valid.violation : originalViolation
      validationResult = gen2.ok === false ? 'regeneration_unavailable' : finalViolation
      if (convo && isSocialMode(modeOf(gen))) {
        // No canned business question and no "your request is waiting for the team" to a friend: say nothing.
        presenceWatch.stop()
        waTrace('CONVERSATIONAL_REPLY_REFUSED', genTrace, { stage: 'validator', violation: finalViolation, mode: modeOf(gen) })
        return { done: await doSkip('social_reply_unavailable') }
      }
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
        const mergedNow = mergeQualification(
          aiState.qualification,
          { ...gen.extracted, cognition: incomingCog },
          { corrected: gen.corrected },
        )
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
        gen.reply = withGreeting(greetingLine, gen.reply)
        validation = validateAutoResponse(gen.reply, validateOpts)
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

  // ── Conversational truthfulness: no invented owner facts, no commitments, no
  //    selling to a friend. One repair, then silence (never a business fallback).
  if (convo && !handoffRequested) {
    const check = checkConversationalReply(gen, identity.name)
    if (check.ok === false) {
      const repair = await deps.generateQualify({ ...genArgs, conversational: promptContextFor(convo, { personalRepair: true }), abortSignal: presenceWatch.signal })
      const repairValid = repair.ok ? validateAutoResponse(repair.reply, validateOpts) : null
      const repairCheck = repair.ok && repairValid?.ok ? checkConversationalReply(repair, identity.name) : null
      waTrace('CONVERSATIONAL_REPLY_CHECK', genTrace, {
        violation: check.violation,
        matched: check.matched,
        repaired: Boolean(repairCheck?.ok),
        mode: modeOf(gen),
      })
      if (repair.ok && repairValid?.ok && repairCheck?.ok) {
        gen.reply = repair.reply
        gen.conversationMode = repair.conversationMode
        gen.modeConfidence = repair.modeConfidence
        gen.personalClaims = repair.personalClaims
        validation = repairValid
      } else {
        presenceWatch.stop()
        return { done: await doSkip('conversational_reply_refused') }
      }
    }
  }

  // Generation (and any repair regeneration) is done — release the watcher.
  presenceWatch.stop()
  if (presenceWatch.cancelled()) return { done: await doSkip('human_typing') }
  return { gen, validation, forcedGuardrail, schedulingOverride, handoffRequested }
}
