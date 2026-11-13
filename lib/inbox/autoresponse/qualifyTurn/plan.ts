/**
 * The qualify turn's DECISION ORDER, without its effects.
 *
 * Moved out of ../qualifyWorker.ts so the same sequence of decisions runs in
 * two places: the worker (which then sends, marks state and records the job)
 * and the owner's simulator (lib/inbox/autoresponse/simulate), which only shows
 * what would happen. The statements are the worker's, in the worker's order;
 * the only change is that each early exit RETURNS a plan instead of acting on
 * it. A decision added here is therefore made identically by both.
 *
 * Reads nothing and writes nothing itself. `resolveGreeting` is the turn's
 * (memoized) greeting resolver and `trace` the turn's waTrace; the simulator
 * passes its own.
 */
import { decidePreGeneration } from '../stateMachine'
import { withinQuietHours } from '../worker'
import { shouldInvokeSalesAi } from '../gptEligibility'
import { detectHumanRequest } from '../salesIntent'
import { decideConversationControl, isConfirmedHandoffOffer } from '../conversationControl'
import { humanTypingBlocksTurn } from '../humanPresence'
import { decideDeterministicTurn, mediaOnlyKind } from '../reliability/silence'
import { meetingOnlyHandoff, socialTurn } from '../conversational/turnRules'
import type { AutoResponseJob } from '@/db/autoResponseJobs'
import type { QualifyCtx, TurnFacts } from './types'
import { courtesyDecision } from './responders'

const WINDOW_MS = 24 * 60 * 60 * 1000

export type TurnPlan =
  /** One warm line, nothing else (courtesyClose). `closeAfter` null keeps an escalated conversation escalated. */
  | { kind: 'courtesy'; closeAfter: string | null }
  /** The pre-generation gate stopped the agent and changes ownership. */
  | { kind: 'stop'; state: 'human_active' | 'opted_out'; reason: string }
  | { kind: 'skip'; reason: string }
  /** The immediate handoff to a person (a request, or an accepted handoff offer). */
  | { kind: 'handoff' }
  | { kind: 'deterministic'; turn: NonNullable<ReturnType<typeof decideDeterministicTurn>> }
  /** Close in silence, unless the courtesy line applies (`courtesy`). */
  | { kind: 'close_silence'; reason: string; courtesy: boolean }
  | { kind: 'closer'; reason: string }
  | { kind: 'generate'; gptEligibility: ReturnType<typeof shouldInvokeSalesAi>; inboundTexts: string[]; deferredMeeting: boolean }

export async function planQualifyTurn(input: {
  facts: TurnFacts
  settings: QualifyCtx['settings']
  master: boolean
  reliability: boolean
  jobCreatedAt: AutoResponseJob['createdAt']
  nowMs: number
  resolveGreeting: () => Promise<{ line: string | null }>
  trace: (event: string, data: Record<string, unknown>) => void
}): Promise<TurnPlan> {
  const { facts, settings, master, reliability, jobCreatedAt, nowMs, resolveGreeting, trace } = input
  const { unanswered, lastOutbound, aiState, convo, humanTookOver, presenceAtTurnStart, sentToday, lastInboundAt, maxTurns, lastInboundText, previousOutbound, previousOutboundKind, closeOfferPending, hasUnansweredInbound, optOut, agentHasSpoken, qTranscript, salesMove, reopenEligible, lang } = facts

  // A conversation waiting on a person may still say thank you. Checked BEFORE
  // the pre-generation gate, which treats `escalated` as a hard stop.
  if (aiState.aiState === 'escalated' && courtesyDecision(facts).send) {
    return { kind: 'courtesy', closeAfter: null }
  }

  // Conversational: a meeting mention is read by the model, not treated as a request for a person.
  const deferredMeeting = !!convo && meetingOnlyHandoff(lastInboundText, previousOutbound)
  const pre = decidePreGeneration({
    aiState: aiState.aiState,
    masterEnabled: master,
    channelEnabled: settings.enabled,
    humanTookOver,
    humanTyping: humanTypingBlocksTurn(presenceAtTurnStart, jobCreatedAt),
    optOut,
    humanRequest: deferredMeeting ? false : detectHumanRequest(lastInboundText, { previousOutbound }),
    hasUnansweredInbound,
    withinQuietHours: withinQuietHours(settings.quietHours, new Date(nowMs)),
    withinWindow: lastInboundAt ? nowMs - lastInboundAt.getTime() < WINDOW_MS : false,
    sentTodayForAgency: sentToday,
    dailyCap: settings.dailyCap,
    turnCount: aiState.aiTurnCount,
    maxTurns,
    reopenEligible,
  })
  trace('PRE_GENERATION_DECISION', { action: pre.action, reason: 'reason' in pre ? pre.reason : null })
  if (pre.action === 'stop') return { kind: 'stop', state: pre.state === 'human_active' ? 'human_active' : 'opted_out', reason: pre.reason }
  if (pre.action === 'skip') return { kind: 'skip', reason: pre.reason }
  if (pre.action === 'handoff') return { kind: 'handoff' }

  // ── Never silent, never a model call: media-only input, and an opener ──────
  // Runs after every stop above (ownership, typing, opt-out, window, quiet
  // hours, cap, closed) and before any AI decision, so it can only answer where
  // the agent was already allowed to speak.
  // A voice note the agent TRIED and failed to understand gets the honest "send it
  // again or write it" line for every agency, not only under reliability: it is
  // never answered from a guess, and it is never met with silence.
  if (reliability || mediaOnlyKind(unanswered) === 'voice_unclear') {
    const firstContact = !agentHasSpoken && aiState.aiState === 'new'
    const deterministic = decideDeterministicTurn({
      pending: unanswered,
      // The conversational agent reads a text opener itself ("אחי מה קורה?" is not "היי"); media is still acknowledged here.
      firstContact: firstContact && !convo,
      greetingLine: firstContact ? (await resolveGreeting()).line : null,
      lang,
      lastOutbound,
    })
    if (deterministic) return { kind: 'deterministic', turn: deterministic }
  }

  const control = decideConversationControl({
    salesMove,
    inboundText: lastInboundText,
    previousOutbound,
    previousOutboundKind,
    closeOfferPending,
  })
  trace('CONVERSATION_CONTROL', { action: control.action, reason: 'reason' in control ? control.reason : null, salesMove, closeOfferPending })
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
  if (socialControl === 'skip_quietly') return { kind: 'skip', reason: 'social_ack' }
  const controlHandoff = control.action === 'HANDOFF_TO_HUMAN' && !deferredMeeting
  if (controlHandoff || handoffAccepted) return { kind: 'handoff' }
  if (socialControl === 'default' && control.action === 'CLOSE_CONVERSATION' && control.send === 'silence') {
    return { kind: 'close_silence', reason: control.reason, courtesy: courtesyDecision(facts).send }
  }
  if (socialControl === 'default' && control.action === 'CLOSE_CONVERSATION' && control.send === 'closer') {
    return { kind: 'closer', reason: control.reason }
  }

  if (socialControl === 'default' && !deferredMeeting && control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { kind: 'skip', reason: 'control_no_generate' }
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
  trace('GPT_ELIGIBILITY', { decision: gptEligibility.decision, reason: gptEligibility.reason, salesMove, controlAction: control.action })
  if (gptEligibility.decision === 'WAIT') {
    const socialWait = convo ? socialTurn({ socialHint: convo.socialHint, inboundText: lastInboundText, salesRuleSilences: true }) : 'default'
    if (socialWait === 'skip_quietly') return { kind: 'skip', reason: 'social_ack' }
    if (socialWait === 'default') return { kind: 'skip', reason: `gpt_wait_${gptEligibility.reason}` }
  }

  return { kind: 'generate', gptEligibility, inboundTexts, deferredMeeting }
}
