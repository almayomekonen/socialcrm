/**
 * The qualify turn's post-generation DECISIONS, without their effects.
 *
 * Moved out of ./completeTurn.ts unchanged so the worker and the owner's
 * simulator (lib/inbox/autoresponse/simulate) decide send / escalate, the
 * handoff wording and the turn's memory with the same code. completeTurn keeps
 * every write and send.
 */
import { mergeQualification, requiredComplete } from '../qualification'
import { decidePostGeneration } from '../stateMachine'
import { handoffMessage, cognitionFromUnderstanding, inboundMemoryText } from '../qualify'
import { isWarmHandoffEnabled, buildWarmHandoff } from '../warmHandoff'
import { memoryAfterTurn, modeOf } from '../conversational/hooks'
import { meetingNeedsTeam } from '../conversational/turnRules'
import type { GeneratedTurn, GenerationInput, QualifyCtx, TurnFacts } from './types'

type Lang = TurnFacts['lang']

/** The turn's cognition, conversation memory, and the qualification it would persist. */
export function turnQualification(t: Pick<TurnFacts, 'aiState' | 'convo' | 'lastInboundText' | 'qTranscript' | 'salesStrategy'> & Pick<GeneratedTurn, 'gen'> & { draftOnly: boolean }) {
  const { aiState, convo, lastInboundText, qTranscript, salesStrategy, gen, draftOnly } = t
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
  const turnMemory = convo ? memoryAfterTurn(convo, gen, { willSend: !draftOnly }) : null
  const persistExtracted = { ...gen.extracted, cognition: incomingCog, ...(turnMemory ? { conversation: turnMemory.memory } : {}) }
  const merged = mergeQualification(aiState.qualification, persistExtracted, { corrected: gen.corrected })
  return { incomingCog, turnMemory, persistExtracted, merged }
}

/** Send or escalate (and why), after generation. */
export function decidePostTurn(
  t: Pick<TurnFacts, 'aiState' | 'convo' | 'maxTurns' | 'salesMove'> &
    Pick<GenerationInput, 'identity'> &
    Pick<GeneratedTurn, 'gen' | 'forcedGuardrail' | 'schedulingOverride' | 'handoffRequested'> & {
      settings: Pick<QualifyCtx['settings'], 'collectFields'>
      merged: ReturnType<typeof turnQualification>['merged']
      deferredMeeting: boolean
    },
) {
  const { aiState, convo, maxTurns, salesMove, identity, gen, forcedGuardrail, schedulingOverride, handoffRequested, settings, merged, deferredMeeting } = t
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
    // The model asked for a person: the existing handoff, never a promise in text.
    if (handoffRequested) post = { action: 'escalate', reason: 'needs_team' }
    // A topic the owner asked a person to handle (owner-configured only).
    if (gen.escalationTopic && (identity.agentProfile?.escalationTopics.length ?? 0) > 0) {
      post = { action: 'escalate', reason: 'escalation_topic' }
    }
  }
  return post
}

/**
 * The handoff wording for an escalation. On a QUALIFIED handoff only, an
 * enabled agency gets a deterministic warm message assembled from known fields;
 * any fallback → the fixed template. Without the greeting (the caller adds it).
 */
export function escalationText(t: {
  agencyId: number
  reason: string
  merged: ReturnType<typeof turnQualification>['merged']
  qTranscript: TurnFacts['qTranscript']
  lang: Lang
  onWarm?: (telemetry: Record<string, unknown>) => void
}): string {
  let handoffText = handoffMessage(t.reason, t.lang)
  if (t.reason === 'qualified' && isWarmHandoffEnabled(t.agencyId)) {
    const warm = buildWarmHandoff({
      name: t.merged.name,
      need: t.merged.need,
      urgency: t.merged.urgency,
      context: t.qTranscript.find((m) => m.direction === 'inbound')?.text,
      lang: t.lang,
    })
    t.onWarm?.({ ...warm.telemetry })
    if (warm.text) handoffText = warm.text
  }
  return handoffText
}
