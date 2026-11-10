/**
 * Reading the facts a qualify turn is decided on.
 *
 * Part of the qualify turn (../qualifyWorker.ts), moved out unchanged so the
 * orchestrator stays reviewable (architecture-rules §1, §5). Behaviour-preserving:
 * the statements are the original ones, in the original order.
 */
import { db } from '@/config/db'
import { countSentToday } from '@/db/autoResponseJobs'
import { getOrCreateAiState } from '@/db/conversationAiState'
import { isPositiveLeadId } from '../contactJob'
import { isSalesStrategy } from '../qualification'
import { detectLang, detectOptOut } from '../qualify'
import { classifySalesTurnFromTranscript } from '../salesIntent'
import { allowsOutbound, countConsecutiveAiOutbounds, isExplicitReopen } from '../conversationControl'
import { recentWindow, type Turn as SummaryTurn } from '../conversationSummary'
import { readHumanPresence } from '@/db/conversationHumanPresence'
import { isNoResponseWarningMessage, metadataKind } from '../noResponseClose'
import { humanTookOverSinceEpoch, legacyHumanTookOver, ownershipEpochSequence } from '../reliability/ownership'
import { readableInboundText } from '../reliability/silence'
import { startConversationalTurn } from '../conversational/hooks'
import { socialReopen } from '../conversational/turnRules'
import type { TurnBase } from './types'
import { metaSource } from './effects'

const MAX_TRANSCRIPT = 80

/** Everything the turn decides on, read once: transcript, ownership, presence, classification. */
export async function readTurnFacts(t: Pick<TurnBase, 'job' | 'ctx' | 'reliability'>) {
  const { job, reliability } = t
  const { settings, conv } = t.ctx
  // ── Gather facts (recent transcript drives batch + turn-taking + takeover) ──
  const rows = await db('inbox_messages')
    .where({ conversationId: conv.id })
    .orderBy('sequence', 'desc')
    .limit(MAX_TRANSCRIPT)
    .select('direction', 'text', 'sentByUserId', 'channelTimestamp', 'createdAt', 'metadata', 'sequence', 'type', 'payload', 'status')
  // Under reliability an image/document/video caption is the customer's text.
  const recent = reliability
    ? rows
        .slice()
        .reverse()
        .map((m) => (m.direction === 'inbound' ? { ...m, text: readableInboundText(m) } : m))
    : rows.slice().reverse()
  const lastMsg = recent[recent.length - 1]
  /**
   * The newest inbound the agent can actually READ.
   *
   * An image, voice note or sticker persists with empty `text`, and the agent
   * answers the newest inbound — so in production conversation 7224 the customer
   * wrote "תודה רבה" and then sent two photos, which made `lastInboundText` an
   * empty string. The thank-you was never seen, the courtesy reply never fired,
   * and every later job skipped. Any text message followed by an attachment had
   * the same fate.
   *
   * Among the messages still awaiting a reply (everything after our last
   * outbound), take the newest one that HAS text. If none of them do — the
   * customer sent only an attachment — fall back to the newest, which keeps the
   * existing low-information handling rather than answering something older.
   */
  const lastOutboundSeq = Number(
    [...recent].reverse().find((m) => m.direction === 'outbound')?.sequence ?? 0,
  )
  const unanswered = recent.filter((m) => m.direction === 'inbound' && Number(m.sequence ?? 0) > lastOutboundSeq)
  const lastInbound =
    [...unanswered].reverse().find((m) => String(m.text ?? '').trim()) ??
    [...recent].reverse().find((m) => m.direction === 'inbound')
  const lastOutbound = [...recent].reverse().find((m) => m.direction === 'outbound')
  const agentSpokeInWindow = recent.some((m) => m.direction === 'outbound' && metaSource(m.metadata) === 'auto_response')

  const aiState = await getOrCreateAiState(conv.id, job.agencyId)
  // Conversational agent (IRE_CONVERSATIONAL_AGENCY_IDS only; null = exactly the old path).
  const convo = await startConversationalTurn({
    agencyId: job.agencyId,
    leadId: isPositiveLeadId(job.leadId) ? job.leadId : null,
    qualification: aiState.qualification,
    nowMs: Date.now(),
  })
  // Human takeover. Under reliability: only a PERSON's outbound (isHumanOutbound)
  // written after the last return-to-agent. Legacy: any outbound not written by
  // the agent — which also caught automation templates and pre-return replies.
  const humanTookOver = reliability
    ? humanTookOverSinceEpoch(recent, ownershipEpochSequence(aiState.qualification))
    : legacyHumanTookOver(recent)
  // Human Presence, read once for the cheap pre-generation stop. Covers both a
  // live signal AND a keystroke already inside this turn, so a job the cron picks
  // up minutes later does not spend an AI call on a reply the boundary will then
  // refuse. This is an early exit, not the guarantee: agentSendGuard re-reads
  // presence at the boundary, after generation, and is what actually decides.
  const presenceAtTurnStart = await readHumanPresence(conv.id)
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
  /**
   * Does the agent own this conversation? Two independent signals, for the same
   * reason the greeting uses two: `aiTurnCount` is durable and survives a
   * transcript window that has scrolled past the opening, while the window scan
   * catches a turn that was sent before the count existed. Either alone would
   * mis-read a long conversation as a first contact and re-apply the opening
   * whitelist to someone mid-sentence.
   */
  const agentHasSpoken = aiState.aiTurnCount > 0 || agentSpokeInWindow
  // Sequenced turns feed the summary planner; qTranscript stays the shape the
  // classifier and prompt builder already take.
  const sequencedTurns: SummaryTurn[] = recent
    .map((m) => ({
      direction: m.direction as 'inbound' | 'outbound',
      text: (m.text as string) ?? '',
      sequence: Number(m.sequence ?? 0),
    }))
    .filter((m) => m.text)
  const qTranscript = recentWindow(sequencedTurns).map((m) => ({ direction: m.direction, text: m.text }))
  const persistedStrategy = isSalesStrategy(aiState.qualification.cognition?.salesStrategy)
    ? aiState.qualification.cognition?.salesStrategy
    : undefined
  const classified = classifySalesTurnFromTranscript(qTranscript, { salesStrategy: persistedStrategy })
  const salesMove = classified.salesMove
  const salesStrategy = classified.salesStrategy
  const social = !!convo && socialReopen({ socialHint: convo.socialHint, inboundText: lastInboundText })
  const reopenEligible = aiState.aiState === 'closed' && isExplicitReopen({ salesMove, inboundText: lastInboundText, social })
  const outboundGate = () =>
    allowsOutbound({
      aiState: aiState.aiState,
      hasUnansweredInbound,
      consecutiveAiWithoutInbound,
      humanTookOver,
      optOut,
      reopenEligible,
    })

  // A turn with no readable text (media only) is not English: it is unknown, and
  // this product speaks Hebrew by default. Legacy kept the old default.
  const lang = reliability && !lastInboundText.trim() ? 'he' : detectLang(lastInboundText)
  return { recent, lastMsg, unanswered, lastInbound, lastOutbound, agentSpokeInWindow, aiState, convo, humanTookOver, presenceAtTurnStart, sentToday, lastInboundAt, maxTurns, lastInboundText, previousOutbound, previousOutboundKind, closeOfferPending, hasUnansweredInbound, consecutiveAiWithoutInbound, optOut, agentHasSpoken, sequencedTurns, qTranscript, salesMove, salesStrategy, reopenEligible, outboundGate, lang }
}
