/**
 * The qualify turn's ORCHESTRATOR: the gates and the order of decisions.
 *
 *   qualifyTurn/turnFacts.ts     what the turn is decided on (transcript, ownership, classification)
 *   qualifyTurn/responders.ts    the greeting and the courtesy reply
 *   (this file)                  kill switch, pre-generation gate, deterministic turns,
 *                                conversation control, GPT eligibility
 *   qualifyTurn/generateTurn.ts  the model call, validation, repair, truthfulness check
 *   qualifyTurn/completeTurn.ts  the post-generation decision; draft / escalate / continue
 *   qualifyTurn/effects.ts       send + persist, shadow qualification, escalation record
 *
 * Every send still goes through sendIreOutbound (send-time gates) after
 * outboundGate(); nothing here or in the modules calls WhatsApp directly.
 */
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { skipAutoResponseJob, completeAutoResponseJob, skipPendingNoResponseJobs, type AutoResponseJob } from '@/db/autoResponseJobs'
import { markHumanActive, markStopped, markClosed } from '@/db/conversationAiState'
import { decidePreGeneration, decidePostGeneration } from './stateMachine'
import { isQualifierEnabled } from './killSwitch'
import { withinQuietHours } from './worker'
import { waTrace } from './waTrace'
import { shouldInvokeSalesAi } from './gptEligibility'
import { detectHumanRequest } from './salesIntent'
import { conversationCloser, decideConversationControl, isConfirmedHandoffOffer } from './conversationControl'
import { humanTypingBlocksTurn } from './humanPresence'
import { runImmediateHumanHandoff } from './immediateHandoff'
import { canUseAgentReliability } from '@/lib/flags/agentReliabilityFlags'
import { decideDeterministicTurn } from './reliability/silence'
import { sendDeterministicTurn } from './reliability/deterministicTurn'
import { meetingOnlyHandoff, socialTurn } from './conversational/turnRules'
import type { Outcome, QualifyCtx, QualifyDeps } from './qualifyTurn/types'
import { readTurnFacts } from './qualifyTurn/turnFacts'
import { turnResponders } from './qualifyTurn/responders'
import { generateValidatedTurn, prepareGeneration } from './qualifyTurn/generateTurn'
import { completeQualifyTurn } from './qualifyTurn/completeTurn'
import { sendAndPersist } from './qualifyTurn/effects'

export type { QualifyCtx, QualifyDeps } from './qualifyTurn/types'

const WINDOW_MS = 24 * 60 * 60 * 1000

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
  // Ownership + silence correctness (reliability/*), per agency.
  const reliability = canUseAgentReliability(job.agencyId)

  const facts = await readTurnFacts({ job, ctx, reliability })
  const { unanswered, lastOutbound, aiState, convo, humanTookOver, presenceAtTurnStart, sentToday, lastInboundAt, maxTurns, lastInboundText, previousOutbound, previousOutboundKind, closeOfferPending, hasUnansweredInbound, optOut, agentHasSpoken, qTranscript, salesMove, reopenEligible, outboundGate, lang } = facts
  const base = { job, ctx, deps, doSkip, reliability }
  const { resolveGreeting, attemptCourtesy } = turnResponders({ ...base, ...facts })

  // A conversation waiting on a person may still say thank you. Checked BEFORE
  // the pre-generation gate, which treats `escalated` as a hard stop.
  if (aiState.aiState === 'escalated') {
    const courtesyOutcome = await attemptCourtesy({ closeAfter: null })
    if (courtesyOutcome) return courtesyOutcome
  }

  // Conversational: a meeting mention is read by the model, not treated as a request for a person.
  const deferredMeeting = !!convo && meetingOnlyHandoff(lastInboundText, previousOutbound)
  const pre = decidePreGeneration({
    aiState: aiState.aiState,
    masterEnabled: master,
    channelEnabled: settings.enabled,
    humanTookOver,
    humanTyping: humanTypingBlocksTurn(presenceAtTurnStart, job.createdAt),
    optOut,
    humanRequest: deferredMeeting ? false : detectHumanRequest(lastInboundText, { previousOutbound }),
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
      greetingLine: (await resolveGreeting()).line,
    })
  }

  // ── Never silent, never a model call: media-only input, and an opener ──────
  // Runs after every stop above (ownership, typing, opt-out, window, quiet
  // hours, cap, closed) and before any AI decision, so it can only answer where
  // the agent was already allowed to speak.
  if (reliability) {
    const firstContact = !agentHasSpoken && aiState.aiState === 'new'
    const deterministic = decideDeterministicTurn({
      pending: unanswered,
      // The conversational agent reads a text opener itself ("אחי מה קורה?" is not "היי"); media is still acknowledged here.
      firstContact: firstContact && !convo,
      greetingLine: firstContact ? (await resolveGreeting()).line : null,
      lang,
      lastOutbound,
    })
    if (deterministic) {
      const gate = outboundGate()
      if (gate.allowed === false) return doSkip(gate.reason)
      return sendDeterministicTurn({
        job,
        ctx,
        send: deps.send,
        turn: deterministic,
        skip: async (reason) => {
          await doSkip(reason)
          return 'skipped'
        },
      })
    }
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
  // ── An offer the customer accepted IS a handoff request ────────────────────
  // Without this, "להעביר את הפנייה שלך לצוות?" → "כן אשמח במיידי!" classified
  // as DISCOVERY, decidePostGeneration returned `send`, and the model wrote
  // "אעביר את הפנייה לצוות" in free text while nothing was transferred: no
  // escalation, no operator summary, no state change. The customer was told a
  // thing had happened that had not. Running the real handoff here makes the
  // sentence true, and writes the summary that carries the urgency.
  const handoffAccepted = isConfirmedHandoffOffer({ previousOutbound, inboundText: lastInboundText })
  // A friend's "חחחח" or goodbye is the conversation, not a close. Handoffs are unaffected.
  const socialControl = convo
    ? socialTurn({ socialHint: convo.socialHint, inboundText: lastInboundText, salesRuleSilences: control.action === 'CLOSE_CONVERSATION' })
    : 'default'
  if (socialControl === 'skip_quietly') return doSkip('social_ack')
  const controlHandoff = control.action === 'HANDOFF_TO_HUMAN' && !deferredMeeting
  if (controlHandoff || handoffAccepted) {
    const gate = outboundGate()
    if (gate.allowed === false) return doSkip(gate.reason)
    return runImmediateHumanHandoff({
      job,
      ctx,
      send: deps.send,
      aiState,
      lastInboundText,
      greetingLine: (await resolveGreeting()).line,
    })
  }
  if (socialControl === 'default' && control.action === 'CLOSE_CONVERSATION' && control.send === 'silence') {
    const courtesyOutcome = await attemptCourtesy({ closeAfter: control.reason })
    if (courtesyOutcome) return courtesyOutcome
    await db.transaction((trx) => skipPendingNoResponseJobs(trx, conv.id))
    await markClosed(conv.id, control.reason)
    return doSkip(`closed_${control.reason}`)
  }
  if (socialControl === 'default' && control.action === 'CLOSE_CONVERSATION' && control.send === 'closer') {
    const gate = outboundGate()
    if (gate.allowed === false) return doSkip(gate.reason)
    // Deliberately NOT greeted. A closer is sent when the customer declined,
    // said goodbye, or confirmed they are done. "Welcome to X 👋 No problem,
    // thanks." welcomes someone out of the door, which reads worse than no
    // welcome at all. The greeting belongs on a reply that opens a
    // conversation, including a handoff — not on one that ends it.
    const r = await sendAndPersist(job, ctx, deps.send, conversationCloser(lang))
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

  if (socialControl === 'default' && !deferredMeeting && control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return doSkip('control_no_generate')
  }

  const inboundTexts = qTranscript.filter((m) => m.direction === 'inbound').map((m) => m.text)
  const gptEligibility = shouldInvokeSalesAi({
    inboundText: lastInboundText,
    previousOutbound,
    previousOutboundKind,
    salesMove,
    // Reached with CLOSE only when a social conversation's message deserves a reply (socialControl 'generate').
    controlAction: control.action === 'CLOSE_CONVERSATION' || control.action === 'HANDOFF_TO_HUMAN' ? 'CONTINUE' : control.action,
    customerInboundCount: inboundTexts.length,
    previousCustomerText: inboundTexts.length >= 2 ? inboundTexts[inboundTexts.length - 2] : undefined,
    agentHasSpoken,
  })
  waTrace(
    'GPT_ELIGIBILITY',
    { conversationId: conv.id, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
    { decision: gptEligibility.decision, reason: gptEligibility.reason, salesMove, controlAction: control.action },
  )
  if (gptEligibility.decision === 'WAIT') {
    const socialWait = convo ? socialTurn({ socialHint: convo.socialHint, inboundText: lastInboundText, salesRuleSilences: true }) : 'default'
    if (socialWait === 'skip_quietly') return doSkip('social_ack')
    if (socialWait === 'default') return doSkip(`gpt_wait_${gptEligibility.reason}`)
  }

  const prepared = await prepareGeneration({ ...base, ...facts, resolveGreeting, attemptCourtesy, gptEligibility, inboundTexts })
  const generated = await generateValidatedTurn({ ...base, ...facts, ...prepared })
  if ('done' in generated) return generated.done
  return completeQualifyTurn({ ...base, ...facts, ...prepared, ...generated, deferredMeeting })
}
