import { db } from '@/config/db'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { TERMINAL_STATUSES, STALE_CEILING_DAYS } from '@/lib/today/constants'
import { TURN_CLASSIFICATION_TABLE } from '@/db/conversationTurnClassification'
import type { Scope } from '@/db/ai/stateManagement'
import { notHistorySql } from '@/lib/inbox/messageTimeline'

/**
 * Wave 1 signal detection — AGENCY-scoped CONVERSATION facts.
 *
 * `db/ai/leadFacts.ts` answers "what does the CRM look like right now" from the
 * `clients` row. This module answers the question the detectors could not ask:
 * "what has actually been SAID, and how did the qualifier read it". It is the
 * sibling ingestion mechanism, and it is additive — no existing reader is
 * touched and no table is created.
 *
 * IT RE-CLASSIFIES NOTHING. Every judgement here was made once, by the
 * qualifier, at the moment the turn was answered, and written to
 * `conversation_turn_classification`. This module reads that record. Running
 * the classifier again on a cron would be a second authority on what a customer
 * meant, and the two would drift the first time a prompt changed.
 *
 * SCOPE. Agency, never viewer — for the same reason `leadFacts` documents: a
 * proactive sweep has no session, and manufacturing one would put `user_perms`
 * on a cron path. Who may SEE a resulting insight is decided later by the
 * notification worker. Detection sees the agency; delivery decides visibility.
 *
 * THE PLAN GATE and the terminal exclusion mirror `leadFacts` exactly: an
 * over-quota lead is invisible in the product on the free plan, and a closed or
 * lost lead is finished business. The runtime must reason about neither.
 *
 * CONTACTS ARE INCLUDED (Wave 1.1A). `conversation_turn_classification."leadId"`
 * is nullable so a leadless Contact conversation is recorded, and these readers
 * now return those rows: the subject becomes the CONVERSATION rather than a
 * fabricated Lead. Every lead-shaped predicate below is guarded so that a NULL
 * lead satisfies it vacuously instead of sweeping the row out — a Contact has no
 * status to be terminal, no quota to exceed, no follow-up date and no tasks.
 *
 * OBSERVABLE, NEVER INVESTIGABLE. A conversation subject may be queued and
 * recorded in coverage; `checkPreconditions` declines it before reserving spend,
 * because a Contact has no handler. Promotion to a Lead is a human decision, via
 * `actions/whatsapp/promoteConversationToLead.ts`.
 */

/** Beyond the existing stale ceiling a conversation is cold — Leads-side revival, never a signal. */
const RECENCY_MS = STALE_CEILING_DAYS * 86_400_000

/** Commercial engagement: the customer was actually transacting, not chatting. */
export const ENGAGEMENT_MOVES = ['BUYING_SIGNAL', 'OBJECTION', 'PRODUCT_QUESTION', 'PRODUCT_FIT'] as const

export interface ObjectionTurnFact {
  conversationId: number
  /** Null for a leadless Contact conversation — the subject is then the conversation. */
  leadId: number | null
  /** The inbound `inbox_messages.sequence` this classification answered. */
  triggerSequence: number
  /** When the classification was written — the observation's discriminator. */
  classifiedAt: number
}

export interface StalledConversationFact {
  conversationId: number
  /** Null for a leadless Contact conversation — the subject is then the conversation. */
  leadId: number | null
  triggerSequence: number
  /** The engagement move that makes this conversation worth noticing. */
  salesMove: string
  /** When that engaged turn was classified. */
  engagedAt: number
}

function toMs(v: unknown): number | null {
  if (v == null) return null
  const t = (v instanceof Date ? v : new Date(v as string)).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * The shared spine both readers sit on: agency-scoped, plan-gated, non-terminal
 * and recent — with every lead-shaped predicate guarded so a leadless Contact
 * satisfies it vacuously. Builder only — SQL-testable via `.toSQL()`.
 */
function engagedTurnsBase(agencyId: number, plan: string, sinceMs: number) {
  const q = db(`${TURN_CLASSIFICATION_TABLE} as t`)
    /**
     * LEFT join, and the tenant predicate moved INTO it.
     *
     * A leadless Contact turn has no `clients` row, so an inner join dropped it
     * — that was Wave 1's lead-only filter. Left-joining keeps it, and carrying
     * `c."agencyId"` in the ON clause rather than the WHERE is what stops the
     * join from silently turning back into an inner one: a WHERE on a
     * left-joined column excludes exactly the NULL rows we are here to include.
     *
     * Tenancy is unaffected. `t."agencyId"` below is the real boundary — every
     * classification row carries its own agency — and the join condition adds a
     * second, matching assertion for the rows that DO have a lead.
     */
    .leftJoin('clients as c', function () {
      this.on('c.id', '=', 't.leadId').andOn('c.agencyId', '=', db.raw('?', [agencyId]))
    })
    .where('t.agencyId', agencyId)
    // Terminal exclusion applies to lead-linked rows only: a Contact has no
    // status to be terminal, and `IS NULL` is what keeps it in the set.
    .where((b) => b.whereNull('t.leadId').orWhereNotIn('c.status', [...TERMINAL_STATUSES]))
    .where('t.createdAt', '>=', new Date(sinceMs))
    // A draft turn was never sent to the customer. Treating it as a real
    // exchange would let a canary conversation produce production signals.
    .where('t.draft', false)
  // The free-plan gate is a LEAD rule: an over-quota lead is invisible in the
  // product, so the runtime must not reason about it. A Contact has no quota
  // state at all, so `IS NULL` keeps it visible rather than sweeping it out.
  if (plan === 'free') q.where((b) => b.whereNull('t.leadId').orWhere('c.overQuota', false))
  return q
}

/**
 * Persisted OBJECTION turns. Builder only.
 *
 * One row per classified turn, and the unique index on
 * `(conversationId, triggerSequence)` means the qualifier already guaranteed
 * exactly one classification per customer turn — so a detector reading this
 * cannot emit two signals for one objection however many times its job retried.
 */
export function agencyObjectionTurnsQuery(agencyId: number, plan: string, sinceMs: number) {
  return engagedTurnsBase(agencyId, plan, sinceMs)
    .where('t.salesMove', 'OBJECTION')
    .orderBy('t.createdAt', 'desc')
    .select('t.conversationId', 't.leadId', 't.triggerSequence', 't.createdAt')
}

/**
 * Conversations that showed commercial engagement and then stopped.
 *
 * CONSERVATIVE BY CONSTRUCTION, and deliberately NOT "last message older than
 * X" — age alone is `sla.open_loop`'s business and is already covered. Four
 * conditions must hold together:
 *
 *   1. a classified turn recorded real engagement (`ENGAGEMENT_MOVES`);
 *   2. the qualifier ANSWERED it (`decision = 'send'`) — an escalated turn is a
 *      human's open item, not a stall;
 *   3. the customer has not written since (no inbound after that turn's trigger);
 *   4. nothing is scheduled — no `nextFollowUpAt`, no open task.
 *
 * Any one of them failing means the conversation is either still moving or
 * already owned by another signal. Prefer the false negative.
 */
export function agencyStalledConversationsQuery(agencyId: number, plan: string, sinceMs: number) {
  return engagedTurnsBase(agencyId, plan, sinceMs)
    .whereIn('t.salesMove', [...ENGAGEMENT_MOVES])
    .where('t.decision', 'send')
    // "Nothing scheduled" is a lead concept. A Contact has no follow-up field
    // and no tasks, so it satisfies both conditions vacuously.
    .where((b) => b.whereNull('t.leadId').orWhereNull('c.nextFollowUpAt'))
    // (3) no customer message after the turn we answered.
    .whereNotExists(function () {
      this.select(db.raw('1'))
        .from('inbox_messages as m')
        .whereRaw('m."conversationId" = t."conversationId"')
        .where('m.direction', 'inbound')
        // `sequence` is CORRECT here and stays: `triggerSequence` is a sequence
        // value, and the question is genuinely "did anything arrive after the
        // turn we answered" — order of arrival, not chronology.
        .whereRaw('m.sequence > t."triggerSequence"')
        // Wave 2A.2a. Precisely because this is arrival-ordered, an imported
        // history row would land ABOVE every triggerSequence in its conversation
        // and read as "the customer has since replied" — silently suppressing a
        // genuine stalled signal for the conversations an archive touched. A
        // no-op until an importer exists; the marker is what makes it safe then.
        .whereRaw(notHistorySql('m'))
    })
    // (4) no open task standing in for a scheduled next step.
    .whereNotExists(function () {
      this.select(db.raw('1')).from('tasks as tk').whereRaw('tk."clientId" = c.id').where('tk.completed', false)
    })
    .orderBy('t.createdAt', 'desc')
    .select('t.conversationId', 't.leadId', 't.triggerSequence', 't.salesMove', 't.createdAt')
}

/** Executed reader — objection turns for one agency. */
export async function listAgencyObjectionTurns(scope: Scope, nowMs: number = Date.now()): Promise<ObjectionTurnFact[]> {
  const plan = await getEffectiveLeadPlan(scope.agencyId)
  const rows = (await agencyObjectionTurnsQuery(scope.agencyId, plan, nowMs - RECENCY_MS)) as Record<string, unknown>[]
  return rows
    .map((r) => ({
      conversationId: Number(r.conversationId),
      leadId: r.leadId == null ? null : Number(r.leadId),
      triggerSequence: Number(r.triggerSequence),
      classifiedAt: toMs(r.createdAt) ?? 0,
    }))
    // The CONVERSATION is now the required identity; the lead is optional.
    .filter((r) => r.conversationId > 0 && r.classifiedAt > 0)
}

/** Executed reader — stalled engaged conversations for one agency. */
export async function listAgencyStalledConversations(
  scope: Scope,
  nowMs: number = Date.now(),
): Promise<StalledConversationFact[]> {
  const plan = await getEffectiveLeadPlan(scope.agencyId)
  const rows = (await agencyStalledConversationsQuery(
    scope.agencyId,
    plan,
    nowMs - RECENCY_MS,
  )) as Record<string, unknown>[]
  return rows
    .map((r) => ({
      conversationId: Number(r.conversationId),
      leadId: r.leadId == null ? null : Number(r.leadId),
      triggerSequence: Number(r.triggerSequence),
      salesMove: String(r.salesMove),
      engagedAt: toMs(r.createdAt) ?? 0,
    }))
    .filter((r) => r.conversationId > 0 && r.engagedAt > 0)
}

/**
 * The subject a conversation-sourced signal is ABOUT.
 *
 * Lead-linked → the Lead, exactly as Wave 1 emitted it. Nothing about existing
 * lead-signal semantics changes: same subjectType, same subjectId, same key.
 *
 * Leadless Contact → the CONVERSATION. Not `portfolio` (that means the whole
 * agency) and never a fabricated Lead (that would invent a CRM record nobody
 * created). The conversation id is a real, tenant-scoped identity that already
 * exists, and it is what the rep would open.
 *
 * Lives here, beside the fact types, so both detectors share ONE rule. Two
 * copies of "which subject is this" is exactly how a Contact ends up labelled a
 * Lead in one detector and not the other.
 *
 * A conversation subject is observable and NOT investigable: `checkPreconditions`
 * declines any non-lead subject before reserving spend.
 */
export function subjectForConversationFact(fact: {
  leadId: number | null
  conversationId: number
}): { subjectType: 'lead' | 'conversation'; subjectId: string } {
  return fact.leadId != null && fact.leadId > 0
    ? { subjectType: 'lead', subjectId: String(fact.leadId) }
    : { subjectType: 'conversation', subjectId: String(fact.conversationId) }
}

/** Everything the conversation-sourced detectors read, loaded once per agency. */
export interface ConversationFacts {
  readonly objections: readonly ObjectionTurnFact[]
  readonly stalled: readonly StalledConversationFact[]
}

/** Empty facts — the value existing detectors receive and ignore. */
export const NO_CONVERSATION_FACTS: ConversationFacts = { objections: [], stalled: [] }

export async function listAgencyConversationFacts(scope: Scope, nowMs: number = Date.now()): Promise<ConversationFacts> {
  const [objections, stalled] = await Promise.all([
    listAgencyObjectionTurns(scope, nowMs),
    listAgencyStalledConversations(scope, nowMs),
  ])
  return { objections, stalled }
}
