/**
 * One questionnaire turn, start to finish.
 *
 * THE ORDER OF OPERATIONS IS THE DESIGN.
 *
 * For a QUESTION: claim the right to send, send, then advance. A session that
 * advanced without its question reaching WhatsApp would leave the customer
 * waiting at a step they were never shown, and nothing would ever ask again.
 *
 * For a TERMINAL turn: save, then send. The answers must survive a failed
 * closing message, an opt-out, a rep taking over mid-sentence.
 *
 * WHAT WE DO NOT CLAIM. This is not exactly-once delivery, and no code here
 * pretends otherwise. A send whose outcome is unknown — a timeout, a dropped
 * connection — is never retried automatically: the session is parked as
 * `needs_review`, the conversation is handed to a person with everything
 * collected so far, and a human decides. Resending would risk a second copy of
 * a message the customer already has; staying silent would strand them. Asking
 * a person is the only honest third option.
 *
 * NOTE: ~325 lines, over the 250-line soft limit, and deliberately not split
 * further. What remains after `finalize.ts` and `types.ts` were extracted is a
 * single linear sequence — gather the facts, decide, check the window, ask or
 * end — and the order of those steps IS the correctness argument documented
 * below. Splitting the sequence across files would hide it.
 */
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { skipAutoResponseJob, completeAutoResponseJob, failAutoResponseJob, type AutoResponseJob } from '@/db/autoResponseJobs'
import { getChannelSettings, getMasterEnabled } from '@/db/autoResponseSettings'
import {
  claimSend,
  findOutboundByTurnKey,
  readSessionForConversation,
  releaseSendClaim,
  startSession,
  consumeUpTo,
} from '@/db/questionnaireSessions'
import { canUseQuestionnaireInteractive, canUseWhatsappQuestionnaire } from '@/lib/flags/whatsappQuestionnaireFlags'
import { canUseAgentReliability } from '@/lib/flags/agentReliabilityFlags'
import { resolveWhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'
import { queryLatestInboundAt } from '@/lib/inbox/whatsappComposerContext'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { sendIreOutbound } from '../ireSend'
import { findStep, parseQuestionnaireDefinition, type QuestionnaireDefinition } from './definition'
import { interactiveSender, planInteractive, tappedSelectionId } from './interactive'
import { classifyInboundKind } from './parseAnswer'
import { persistQuestionTurn } from './effects'
import { finalizeTerminal, parkForReview } from './finalize'
import { decideQuestionnaireTurn, type InboundInput } from './transition'
import { deferForTypingHold } from './typingDefer'
import { QUESTIONNAIRE_SEND_TIMEOUT_MS, type QuestionnaireDeps, type QuestionnaireOutcome } from './types'
import { waTrace } from '../waTrace'
import { humanTookOverSinceEpoch, ownershipEpochSequence } from '../reliability/ownership'

const TERMINAL_LEAD_STATUSES = ['closed', 'lost']
const MAX_TRANSCRIPT = 60


export async function processQuestionnaireJob(
  job: AutoResponseJob,
  deps: QuestionnaireDeps = { send: sendWhatsappText },
): Promise<QuestionnaireOutcome> {
  const trace = { conversationId: job.conversationId, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence }
  const skip = async (reason: string): Promise<QuestionnaireOutcome> => {
    await skipAutoResponseJob(job.id, reason)
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_skipped',
      props: { conversationId: job.conversationId, reason, mode: 'questionnaire' },
    })
    waTrace('QUESTIONNAIRE_TURN', trace, { outcome: 'skipped', reason })
    return 'skipped'
  }

  const conv = await db('inbox_conversations')
    .where({ id: job.conversationId, agencyId: job.agencyId })
    .first('id', 'businessPhoneNumberId', 'customerWaId', 'customerName', 'isPersonal', 'leadId')
  if (!conv) return skip('conversation_gone')
  if (conv.isPersonal === true) return skip('personal')

  const leadId = conv.leadId != null && Number(conv.leadId) > 0 ? Number(conv.leadId) : null
  const lead = leadId
    ? await db('clients').where({ id: leadId, agencyId: job.agencyId }).first('id', 'userId', 'handlerId', 'status', 'firstName')
    : null
  if (leadId && !lead) return skip('lead_gone')

  const [master, settings, session] = await Promise.all([
    getMasterEnabled(job.agencyId),
    getChannelSettings(job.agencyId, job.channel),
    readSessionForConversation(job.agencyId, job.conversationId),
  ])

  // ── Is the questionnaire allowed to speak at all? ─────────────────────────
  // Four independent switches, any of which silences it. None of them can make
  // a turn fall through to the AI agent: this worker has no path to one.
  const parsedDefinition = parseQuestionnaireDefinition(settings?.questionnaire ?? null)
  if (parsedDefinition.ok === false && settings?.responder === 'questionnaire') {
    console.error('[questionnaire] invalid definition', { agencyId: job.agencyId, errors: parsedDefinition.errors })
  }
  const routed =
    master === true &&
    settings?.enabled === true &&
    settings?.responder === 'questionnaire' &&
    canUseWhatsappQuestionnaire(job.agencyId) &&
    parsedDefinition.ok

  // A live session finishes on the definition it started with, which it froze
  // at its first question. Menu numbers and branches only mean something
  // against the menu the customer was actually shown: after an edit, "5" may
  // name a different option. A changed definition applies from the next
  // conversation. The frozen copy also winds a session down if the current
  // definition stops validating.
  const pinned = session?.status === 'active' ? sessionDefinition(session.definition) : null
  const definition: QuestionnaireDefinition | null =
    pinned ?? (parsedDefinition.ok ? parsedDefinition.definition : sessionDefinition(session?.definition))
  if (!definition) return skip(routed ? 'definition_invalid' : 'not_routed')

  const rows = await db('inbox_messages')
    .where({ conversationId: job.conversationId, agencyId: job.agencyId })
    .orderBy('sequence', 'desc')
    .limit(MAX_TRANSCRIPT)
    .select('direction', 'type', 'text', 'payload', 'sequence', 'metadata', 'sentByUserId', 'status')
  const transcript = rows.slice().reverse()

  const lastConsumed = session?.status === 'active' ? session.lastConsumedSequence : 0
  const inputs: InboundInput[] = transcript
    .filter((m) => m.direction === 'inbound' && Number(m.sequence) > lastConsumed)
    .map((m) => ({
      sequence: Number(m.sequence),
      kind: classifyInboundKind(String(m.type ?? 'unknown'), String(m.text ?? '')),
      text: String(m.text ?? ''),
      selectedId: tappedSelectionId(String(m.type ?? ''), m.payload) ?? undefined,
    }))

  const aiStateRow = await db('conversation_ai_state')
    .where({ conversationId: job.conversationId })
    .first('aiState', 'qualification')
  // Ownership is the AI agent's rule (reliability/ownership.ts) for agencies in
  // the reliability rollout: a person's outbound, after the last return-to-agent.
  const humanTookOver = canUseAgentReliability(job.agencyId)
    ? humanTookOverSinceEpoch(transcript, ownershipEpochSequence(aiStateRow?.qualification))
    : transcript.some((m) => m.direction === 'outbound' && isHumanAuthored(m))

  const decision = decideQuestionnaireTurn({
    definition,
    session: session && session.status === 'active' ? session : session ? { ...session } : null,
    inputs,
    now: new Date(),
    routedToQuestionnaire: routed,
    aiState: (aiStateRow?.aiState as never) ?? 'new',
    humanTookOver,
    hasPriorOutbound: transcript.some((m) => m.direction === 'outbound'),
    leadStatusTerminal: Boolean(lead?.status && TERMINAL_LEAD_STATUSES.includes(String(lead.status))),
  })
  waTrace('QUESTIONNAIRE_DECISION', trace, {
    kind: decision.kind,
    reason: decision.reason,
    routed,
    sessionStatus: session?.status ?? null,
    inputs: inputs.length,
  })

  if (decision.kind === 'none') {
    if (decision.consumeThrough != null && session?.status === 'active') {
      await consumeUpTo(job.agencyId, session.id, decision.consumeThrough)
    }
    return skip(decision.reason)
  }

  // The window is checked once, here, for both kinds of turn: a job processed
  // long after its trigger (a retry, a backlog) must not try to send free text
  // into a closed window, and this feature never sends a template.
  const latestInboundAt = await queryLatestInboundAt(job.agencyId, job.conversationId)
  if (resolveWhatsappServiceWindow(latestInboundAt) !== 'OPEN') {
    if (decision.kind === 'terminal') {
      // Still record it. The rep gets the answers; only the message is lost.
      await finalizeTerminal(job, conv, definition, decision, { deliver: false, deps, leadId })
      return skip('outside_window_saved')
    }
    return skip('outside_window')
  }

  if (decision.kind === 'terminal') {
    const outcome = await finalizeTerminal(job, conv, definition, decision, { deliver: true, deps, leadId })
    if (outcome === 'ambiguous') {
      await skipAutoResponseJob(job.id, 'terminal_send_ambiguous')
      return 'skipped'
    }
    await completeAutoResponseJob(job.id, null)
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_sent',
      props: { conversationId: job.conversationId, reason: `questionnaire_${decision.reason}` },
    })
    return 'sent'
  }

  // ── A question ───────────────────────────────────────────────────────────
  let live = session && session.status === 'active' ? session : null
  if (decision.startsSession) {
    live = await startSession({
      agencyId: job.agencyId,
      conversationId: job.conversationId,
      leadId,
      channel: job.channel,
      definition,
      definitionRevision: definition.revision,
    })
  }
  if (!live || live.status !== 'active') return skip('session_unavailable')

  const turnKey = `${live.id}:v${live.version}`
  const already = await findOutboundByTurnKey(job.agencyId, job.conversationId, turnKey)
  // A message stamped with this turn's key already exists: the send succeeded
  // and the process died before the session advanced. Finish the commit rather
  // than asking the same question twice.
  let sentMessageId: number | null = already?.messageId ?? null
  if (!already) {
    const claimed = await claimSend({
      agencyId: job.agencyId,
      sessionId: live.id,
      version: live.version,
      pendingTransition: { turnKey, stepId: decision.stepId, reason: decision.reason },
    })
    if (!claimed) return skip('send_claim_held')

    // Tap-to-select where the agency has it and the question fits; numbered
    // text otherwise, and as the fallback if Meta rejects the interactive one.
    const plan = canUseQuestionnaireInteractive(job.agencyId) ? planInteractive(findStep(definition, decision.stepId)) : null
    const send = plan ? interactiveSender(plan, { sendText: deps.send, sendInteractive: deps.sendInteractive }) : deps.send
    const sent = await sendIreOutbound(
      job,
      {
        conv: {
          id: Number(conv.id),
          businessPhoneNumberId: String(conv.businessPhoneNumberId),
          customerWaId: (conv.customerWaId as string | null) ?? null,
          customerName: (conv.customerName as string | null) ?? null,
        },
        lead: { userId: (lead?.userId as number | null) ?? null, handlerId: (lead?.handlerId as number | null) ?? null },
      },
      send,
      decision.text,
      {
        source: 'auto_response',
        reason: job.reason,
        phase: 1,
        kind: 'questionnaire',
        questionnaireTurnKey: turnKey,
        ...(plan ? { interactive: plan.kind } : {}),
      },
      { timeoutMs: QUESTIONNAIRE_SEND_TIMEOUT_MS, skipAnalysis: true },
    )

    if (sent.ok === false) {
      if (sent.ambiguous) {
        // We do not know whether the customer received this question. Park it
        // and put a person on it rather than guessing in either direction.
        await parkForReview(job, conv, definition, decision.answers, live.id, leadId)
        await skipAutoResponseJob(job.id, 'send_ambiguous_parked')
        return 'skipped'
      }
      await releaseSendClaim(job.agencyId, live.id)
      if (sent.settled) return 'failed'
      if (sent.reason === 'human_typing') {
        // A hold that began before this turn: ask once it lapses, not never.
        const notBefore = await deferForTypingHold(job)
        waTrace('QUESTIONNAIRE_TURN', trace, { outcome: 'deferred', reason: sent.reason, notBefore: notBefore.toISOString() })
        return 'deferred'
      }
      return skip(sent.reason)
    }
    sentMessageId = sent.messageId
  }

  const advanced = await persistQuestionTurn({
    agencyId: job.agencyId,
    conversationId: job.conversationId,
    sessionId: live.id,
    version: live.version,
    leadId,
    definition,
    stepId: decision.stepId,
    answers: decision.answers,
    invalidCount: decision.invalidCount,
    lastConsumedSequence: decision.consumeThrough,
  })
  if (!advanced) {
    // Another worker moved the session while we were sending. The message is
    // out; the state belongs to whoever won. Nothing further to do here.
    await failAutoResponseJob(job.id, 'questionnaire_version_conflict')
    return 'failed'
  }

  await completeAutoResponseJob(job.id, sentMessageId)
  await track({
    agencyId: job.agencyId,
    event: 'auto_response_sent',
    props: { conversationId: job.conversationId, reason: `questionnaire_${decision.reason}` },
  })
  waTrace('QUESTIONNAIRE_TURN', trace, { outcome: 'sent', reason: decision.reason, stepId: decision.stepId })
  return 'sent'
}
/**
 * An outbound nobody automated: a rep's own reply, or an echo from the business
 * phone. The rule for agencies outside the reliability rollout, kept verbatim.
 */
function isHumanAuthored(row: Record<string, unknown>): boolean {
  const meta = row.metadata
  let source = ''
  try {
    const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
    source = (parsed as { source?: string } | null)?.source ?? ''
  } catch {
    source = ''
  }
  if (source === 'auto_response') return false
  // An automation's template send carries no source and no user. That is a
  // machine talking, not a person taking over, and treating it as takeover
  // would stop the questionnaire the first time an unrelated automation fired.
  if (!source && row.sentByUserId == null) return false
  return true
}

function sessionDefinition(value: unknown): QuestionnaireDefinition | null {
  const parsed = parseQuestionnaireDefinition(value ?? null)
  return parsed.ok ? parsed.definition : null
}
