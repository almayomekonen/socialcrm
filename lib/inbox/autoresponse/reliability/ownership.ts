import { isHumanOutbound } from '@/lib/inbox/humanReply'

/**
 * Who owns the conversation, read from the transcript. Pure.
 *
 * THE RULE. Only a PERSON's outbound establishes human ownership, and only one
 * written after the latest "return to agent":
 *
 *   · a person = `isHumanOutbound` (lib/inbox/humanReply.ts) — a SocialCRM send
 *     with a user and no `metadata.source`, or a Coexistence echo from the
 *     WhatsApp Business app. The same definition the notifications and the
 *     Today page already use.
 *   · NOT a person: the agent (`auto_response`), the questionnaire
 *     (`questionnaire`), automation template sends (no source, no user),
 *     imported history (it carries its own source), failed sends.
 *
 * The legacy rule treated every outbound whose source was not `auto_response`
 * as a takeover. That made an automation template silence the agent for good,
 * and made "return to agent" re-pause on the very next customer message,
 * because the rep's earlier messages were still in the transcript window.
 *
 * THE EPOCH. `returnConversationToAgent` records the highest message sequence
 * at the moment of the return (`qualification.ownership.sinceSequence`).
 * Messages at or below it belong to the ownership period that the rep just
 * ended; only a human outbound ABOVE it can take the conversation again.
 * Sequences are allocated per conversation under a row lock, so the order is
 * exact and independent of any clock.
 *
 * SHARED. The AI worker (qualifyWorker.ts) and the questionnaire
 * (questionnaire/processJob.ts) both decide takeover here; what each responder
 * DOES once a person owns the conversation stays its own.
 */

export type TranscriptRow = {
  direction: string
  metadata?: unknown
  sentByUserId?: number | null
  status?: string | null
  sequence?: number | string | null
}

export function metadataSource(metadata: unknown): string | null {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    const s = (m as { source?: unknown } | null)?.source
    return typeof s === 'string' && s ? s : null
  } catch {
    return null
  }
}

/** Highest sequence covered by the last return-to-agent, or 0 when never returned. */
export function ownershipEpochSequence(qualification: unknown): number {
  const o = (qualification as { ownership?: { sinceSequence?: unknown } } | null)?.ownership
  const n = Number(o?.sinceSequence)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function isHumanTranscriptOutbound(m: TranscriptRow): boolean {
  if (m.direction !== 'outbound') return false
  return isHumanOutbound({
    source: metadataSource(m.metadata),
    sentByUserId: m.sentByUserId == null ? null : Number(m.sentByUserId),
    status: m.status ?? null,
  })
}

/**
 * A person answered in this conversation after the ownership epoch.
 *
 * A human row whose position is unknown (no usable sequence) counts as AFTER
 * the epoch: when we cannot tell whether a person's reply predates the return,
 * the person wins. Every persisted row has a sequence; this only decides the
 * uncertain case, and decides it the safe way.
 */
export function humanTookOverSinceEpoch(rows: readonly TranscriptRow[], epochSequence: number): boolean {
  return rows.some((m) => {
    if (!isHumanTranscriptOutbound(m)) return false
    const seq = Number(m.sequence)
    if (!Number.isFinite(seq) || seq <= 0) return true
    return seq > epochSequence
  })
}

/** The rule before this change, kept verbatim for agencies outside the rollout. */
export function legacyHumanTookOver(rows: readonly TranscriptRow[]): boolean {
  return rows.some((m) => m.direction === 'outbound' && (metadataSource(m.metadata) ?? '') !== 'auto_response')
}
