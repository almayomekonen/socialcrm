import 'server-only'
import type { AutoResponseJob } from '@/db/autoResponseJobs'
import type { AutoResponseSettings } from '@/db/autoResponseSettings'
import type { ConversationAiStateRow } from '@/db/conversationAiState'
import { canUseAgentReliability } from '@/lib/flags/agentReliabilityFlags'
import { generateQualifyTurn, type QualifyGenResult } from '../qualify'
import { mergeQualification, type AiState, type Qualification } from '../qualification'
import { stateAfterAgentTurn } from '../agentOwnership'
import { conversationCloser } from '../conversationControl'
import { courtesyLine } from '../courtesyClose'
import { withGreeting } from '../greeting'
import { immediateHandoffText } from '../immediateHandoff'
import type { BusinessIdentity } from '../businessIdentity'
import { startConversationalTurn, modeOf } from '../conversational/hooks'
import type { ConversationMode } from '../conversational/mode'
import { turnFactsFrom } from '../qualifyTurn/turnFacts'
import { greetingFor } from '../qualifyTurn/responders'
import { planQualifyTurn } from '../qualifyTurn/plan'
import { generateValidatedTurn, prepareGeneration } from '../qualifyTurn/generateTurn'
import { decidePostTurn, escalationText, turnQualification } from '../qualifyTurn/postDecision'
import type { QualifyCtx, QualifyDeps, TurnBase } from '../qualifyTurn/types'

/**
 * The owner's simulator, on the REAL conversational agent.
 *
 * Runs the production qualify turn — the same facts derivation
 * (turnFactsFrom), decision order (planQualifyTurn), greeting rule, prompt
 * construction and model call (prepareGeneration / generateValidatedTurn), and
 * the same post-generation decision and handoff wording (postDecision) — on a
 * conversation that exists only in the owner's test chat.
 *
 * What is different is execution only, and every difference is listed here:
 * - Nothing is sent: `send` refuses, and no reply ever reaches WhatsApp.
 * - Nothing is written: no conversation, message, lead, job, summary, AI state,
 *   notification or escalation. The turn's next AI state is RETURNED, and the
 *   chat passes it back with the next message.
 * - Delivery conditions are treated as met: auto response on, inside the
 *   24-hour window, outside quiet hours, under the daily cap, nobody typing,
 *   draft off. They decide WHETHER a reply goes out, never what it says; the
 *   owner is testing what it says.
 * - There is no lead, so the CRM context is that of a new contact.
 * - The model call skips the AI allowlist, as the simulator always has.
 */

export type SimState = { aiState: AiState; aiTurnCount: number; qualification: Qualification }
export type SimTurn = { direction: 'inbound' | 'outbound'; text: string }

export type SimOutcome =
  /** A reply the real agent would send. */
  | 'reply'
  /** The real agent would hand the conversation to a person, with this message. */
  | 'handoff'
  /** The real agent would close the conversation (with `reply`, or in silence). */
  | 'closed'
  /** The real agent would send nothing this turn. */
  | 'silent'

export type SimResult = {
  outcome: SimOutcome
  reply: string
  /** Why: the escalation reason, the skip reason, or the close reason. */
  reason: string | null
  mode: ConversationMode | null
  greeted: boolean
  salesMove: string
  language: 'he' | 'en'
  validator: string
  state: SimState
}

const AI_STATES: readonly AiState[] = ['new', 'ai_qualifying', 'escalated', 'dormant', 'opted_out', 'human_active', 'closed']

/** The chat's state comes back from the browser: never trusted, always rebuilt. */
export function sanitiseSimState(raw: unknown): SimState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const aiState = AI_STATES.includes(r.aiState as AiState) ? (r.aiState as AiState) : 'new'
  const count = Number(r.aiTurnCount)
  const aiTurnCount = Number.isSafeInteger(count) && count >= 0 && count <= 1000 ? count : 0
  const q = r.qualification && typeof r.qualification === 'object' && JSON.stringify(r.qualification).length <= 20_000 ? (r.qualification as Qualification) : {}
  return { aiState, aiTurnCount, qualification: mergeQualification({}, q) }
}

/** The test chat as the worker's `inbox_messages` rows, newest first. Agent outbounds are marked as the agent's. */
function rowsFor(transcript: SimTurn[], nowMs: number) {
  return transcript
    .map((t, i) => {
      const at = new Date(nowMs - (transcript.length - i) * 1000).toISOString()
      return {
        direction: t.direction,
        text: t.text,
        sentByUserId: null,
        channelTimestamp: at,
        createdAt: at,
        metadata: t.direction === 'outbound' ? { source: 'auto_response' } : null,
        sequence: i + 1,
        type: 'text',
        payload: null,
        status: t.direction === 'outbound' ? 'sent' : null,
      }
    })
    .reverse()
}

const inertPresence: NonNullable<QualifyDeps['watchPresence']> = () => ({
  signal: new AbortController().signal,
  cancelled: () => false,
  stop: () => {},
})

export async function simulateConversationalTurn(input: {
  agencyId: number
  settings: AutoResponseSettings
  identity: BusinessIdentity
  transcript: SimTurn[]
  state: SimState
  nowMs: number
}): Promise<SimResult | { unavailable: 'not_conversational' } | { generationFailed: string }> {
  const { agencyId, identity, transcript, state, nowMs } = input
  const convo = await startConversationalTurn({ agencyId, leadId: null, qualification: state.qualification, nowMs })
  if (!convo) return { unavailable: 'not_conversational' }

  const settings: AutoResponseSettings = {
    ...input.settings,
    // The owner may be testing unsaved text; the prompt reads it from here as well as from the identity.
    guidance: identity.guidance,
    agentInstructions: identity.agentInstructions,
    enabled: true,
    quietHours: {},
    dailyCap: Number.MAX_SAFE_INTEGER,
    draft: false,
  }
  const reliability = canUseAgentReliability(agencyId)
  const aiState: ConversationAiStateRow = {
    conversationId: 0,
    agencyId,
    aiState: state.aiState,
    aiTurnCount: state.aiTurnCount,
    aiLastAt: null,
    qualification: state.qualification,
    escalatedAt: null,
    escalationReason: null,
    stoppedReason: null,
    humanTypingUntil: null,
    humanTypingAt: null,
    humanTypingUserId: null,
    summary: null,
    summaryThroughSequence: 0,
  }
  const facts = turnFactsFrom({ rows: rowsFor(transcript, nowMs), aiState, convo, presenceAtTurnStart: { aiState: state.aiState, humanTypingUntil: null, humanTypingAt: null, now: new Date(nowMs).toISOString() }, sentToday: 0, settings, reliability })
  const { lang, salesMove } = facts

  let greetingResolved: { identity: BusinessIdentity; line: string | null } | null = null
  const resolveGreeting = async () => {
    greetingResolved ??= greetingFor({ identity, priorOutbound: transcript.some((t) => t.direction === 'outbound'), aiState, lang })
    return greetingResolved
  }

  const nowIso = new Date(nowMs).toISOString()
  const job: AutoResponseJob = { id: 0, agencyId, conversationId: 0, leadId: null, channel: 'whatsapp', reason: 'qualify_turn', triggerSequence: transcript.length, attempts: 1, maxAttempts: 1, createdAt: nowIso }
  const ctx: QualifyCtx = { master: true, settings, conv: { id: 0, businessPhoneNumberId: 'simulation', customerWaId: null, customerName: null }, lead: { id: null, userId: null, handlerId: null, status: null } }
  let skipReason: string | null = null
  // The model call failed (production retries or skips the job): the owner sees the reason, never a fake silence.
  let generationFailure: string | null = null
  const base: TurnBase = {
    job,
    ctx,
    deps: {
      send: async () => {
        throw new Error('simulation never sends')
      },
      generateQualify: async (args) => {
        const gen = await generateQualifyTurn({ ...args, bypassAllowlist: true })
        if (gen.ok === false) generationFailure ??= gen.skipReason
        return gen
      },
      persistSummary: async () => {},
      failJob: async () => {},
      watchPresence: inertPresence,
    },
    doSkip: async (reason) => {
      skipReason = reason
      return 'skipped'
    },
    reliability,
  }

  const result = (outcome: SimOutcome, reply: string, reason: string | null, next: SimState, extra: { mode?: ConversationMode | null; greeted?: boolean; validator?: string } = {}): SimResult => ({
    outcome,
    reply,
    reason,
    mode: extra.mode ?? null,
    greeted: extra.greeted ?? false,
    salesMove,
    language: lang,
    validator: extra.validator ?? 'ok',
    state: next,
  })
  const escalated: SimState = { ...state, aiState: 'escalated' }
  const opensWith = (reply: string, line: string | null) => Boolean(line) && reply.startsWith(line as string)
  const agentTurn = (qualification: Qualification): SimState => ({
    aiState: reliability && state.aiState === 'closed' && facts.reopenEligible ? 'ai_qualifying' : (stateAfterAgentTurn(state.aiState) ?? state.aiState),
    aiTurnCount: state.aiTurnCount + 1,
    qualification,
  })

  const plan = await planQualifyTurn({ facts, settings, master: true, reliability, jobCreatedAt: nowIso, nowMs, resolveGreeting, trace: () => {} })
  const gate = facts.outboundGate()
  const blocked = () => result('silent', '', gate.allowed === false ? gate.reason : null, state)

  switch (plan.kind) {
    case 'courtesy':
      if (gate.allowed === false) return blocked()
      return result('reply', courtesyLine(lang, 0), 'courtesy', state)
    case 'stop':
      return result('silent', '', plan.reason, { ...state, aiState: plan.state })
    case 'skip':
      return result('silent', '', plan.reason, state)
    case 'handoff': {
      if (gate.allowed === false) return blocked()
      const line = (await resolveGreeting()).line
      return result('handoff', immediateHandoffText(line, facts.lastInboundText), 'human_request', escalated, { greeted: Boolean(line) })
    }
    case 'deterministic':
      if (gate.allowed === false) return blocked()
      return result('reply', plan.turn.text, 'deterministic', agentTurn(state.qualification))
    case 'close_silence':
      // As attemptCourtesy: the courtesy line, or the gate's refusal; only otherwise a silent close.
      if (plan.courtesy) return gate.allowed === false ? blocked() : result('closed', courtesyLine(lang, 0), plan.reason, { ...state, aiState: 'closed' })
      return result('closed', '', plan.reason, { ...state, aiState: 'closed' })
    case 'closer':
      if (gate.allowed === false) return blocked()
      return result('closed', conversationCloser(lang), plan.reason, { ...state, aiState: 'closed' })
    case 'generate': {
      const { gptEligibility, inboundTexts, deferredMeeting } = plan
      const attemptCourtesy = async () => null
      const prepared = await prepareGeneration({ ...base, ...facts, resolveGreeting, attemptCourtesy, gptEligibility, inboundTexts })
      const generated = await generateValidatedTurn({ ...base, ...facts, ...prepared })
      if ('done' in generated) {
        // A failed model call is not the agent choosing silence; a repair that failed after a valid first reply is (production skips it).
        if (generationFailure && (generated.done === 'failed' || skipReason === generationFailure)) return { generationFailed: generationFailure }
        return result('silent', '', skipReason, state)
      }
      const { gen, validation } = generated
      const mode = modeOf(gen as QualifyGenResult)
      const validator = validation.ok ? 'ok' : 'violation' in validation ? validation.violation : 'invalid'
      const { merged } = turnQualification({ ...facts, gen, draftOnly: false })
      const post = decidePostTurn({ ...facts, identity: prepared.identity, ...generated, settings, merged, deferredMeeting })
      if (post.action === 'escalate') {
        if (gate.allowed === false) return blocked()
        const text = escalationText({ agencyId, reason: post.reason, merged, qTranscript: facts.qTranscript, lang })
        return result('handoff', withGreeting(prepared.greetingLine, text), post.reason, { ...escalated, qualification: merged }, { mode, greeted: opensWith(text, prepared.greetingLine) || Boolean(prepared.greetingLine), validator })
      }
      if (gate.allowed === false) return blocked()
      return result('reply', gen.reply, null, agentTurn(merged), { mode, greeted: opensWith(gen.reply, prepared.greetingLine), validator })
    }
  }
}
