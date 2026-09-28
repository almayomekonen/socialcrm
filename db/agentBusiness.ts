import { db } from '@/config/db'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { BRIEFING_SAMPLE_LIMIT } from '@/lib/copilot/general/constants'
import { notHistorySql } from '@/lib/inbox/messageTimeline'
import { scopedLeads, type BriefingLeadList, type BriefingLeadRow, type SessionlessScope } from '@/db/briefing'

/**
 * Business-intelligence readers for the Agent.
 *
 * WHAT IS NEW HERE, AND WHAT IS NOT. Most of the agent's business questions are
 * already answered by `db/briefing.ts` — who is due, who has gone cold, who is
 * waiting. This module adds only the reads that did not exist: leads with no
 * next step at all, follow-ups already past their date, the size of the book,
 * and period-over-period activity. Everything else the BI tools need is composed
 * from the briefing readers rather than re-queried, so the Agent and the Today
 * briefing cannot disagree about who is overdue.
 *
 * SCOPE IS A REQUIRED ARGUMENT, NOT AN AMBIENT ONE. Every function takes
 * `SessionlessScope`, whose `agencyId` is REQUIRED, and every query is built
 * from `scopedLeads(agencyId, plan, s)` — the same primitive the briefing uses,
 * which applies the agency, `gotPermIds` for non-admins, the free-plan
 * `overQuota` filter and `lead = true`.
 *
 * Nothing here calls `getAgencyId()`. That is deliberate and it is the whole
 * reason the type is `SessionlessScope`: six briefing readers used to resolve the
 * agency from the session cookie while ignoring the scope they were handed, so a
 * caller that supplied an agency was silently overruled. It was invisible while
 * every caller was interactive and became a correctness bug the moment a tool
 * called them. The compiler now refuses a caller that forgets, and there is no
 * session fallback in this file to fall back TO.
 *
 * Read-only. No writes, no mutations, no side effects.
 */

/** Shape the briefing uses: a true total plus a capped, citable sample. */
function toList(rows: (BriefingLeadRow & { total: number })[]): BriefingLeadList {
  return {
    total: Number(rows[0]?.total ?? 0),
    sample: rows.map(({ total: _t, ...row }) => row),
  }
}

/** Statuses that mean the lead is no longer being worked. */
const TERMINAL = ['closed', 'lost']

/**
 * How big is the book.
 *
 * The gap the first live evaluation found: "כמה לידים יש לי?" could not be
 * answered, because every existing reader counts a SEGMENT and none counts the
 * whole. `open` excludes closed and lost, so "how many leads do I have" and "how
 * many am I still working" are answerable separately rather than conflated.
 */
export async function getLeadTotals(s: SessionlessScope): Promise<{ all: number; open: number }> {
  const plan = await getEffectiveLeadPlan(s.agencyId)
  const [allRow, openRow] = await Promise.all([
    scopedLeads(s.agencyId, plan, s).count<{ count: string }>('id as count').first(),
    scopedLeads(s.agencyId, plan, s).whereNotIn('status', TERMINAL).count<{ count: string }>('id as count').first(),
  ])
  return { all: Number(allRow?.count ?? 0), open: Number(openRow?.count ?? 0) }
}

/**
 * Follow-ups whose date has already passed.
 *
 * Distinct from `getFollowUpsDueToday`, which is today's window only. A
 * follow-up set for last Tuesday is not "due today" and was invisible to every
 * existing reader — the most common way a lead quietly goes unworked.
 */
export async function getOverdueFollowUps(s: SessionlessScope): Promise<BriefingLeadList> {
  const plan = await getEffectiveLeadPlan(s.agencyId)
  const rows = await scopedLeads(s.agencyId, plan, s)
    .whereNotNull('nextFollowUpAt')
    .whereRaw(`"nextFollowUpAt" < date_trunc('day', NOW())`)
    .whereNotIn('status', TERMINAL)
    .select(
      'id',
      'name',
      'status',
      db.raw('COUNT(*) OVER()::int as total'),
      db.raw('(CURRENT_DATE - "nextFollowUpAt"::date)::int as "waitingDays"'),
    )
    .orderBy('nextFollowUpAt', 'asc')
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows as never)
}

/**
 * Open leads with no next step at all — no follow-up date and no open task.
 *
 * NOT the same as "gone cold". A lead contacted this morning with nothing
 * scheduled after it is not stale yet, but nothing will surface it again; that
 * is the difference between a lead that is waiting and a lead that has been
 * dropped. Answering "האם אני מפספס לידים?" honestly needs this set.
 */
export async function getLeadsWithoutNextStep(s: SessionlessScope): Promise<BriefingLeadList> {
  const plan = await getEffectiveLeadPlan(s.agencyId)
  const openTasks = db('tasks').select('clientId').where('completed', false)
  const rows = await scopedLeads(s.agencyId, plan, s)
    .whereNull('nextFollowUpAt')
    .whereNotIn('status', TERMINAL)
    .whereNotIn('id', openTasks)
    .select(
      'id',
      'name',
      'status',
      db.raw('COUNT(*) OVER()::int as total'),
      db.raw('(CURRENT_DATE - "lastActivityAt"::date)::int as "ageDays"'),
    )
    .orderByRaw(`"lastActivityAt" ASC NULLS FIRST`)
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows as never)
}

/** One window's worth of activity. Every field is a count of real rows. */
export type ActivityWindow = {
  newLeads: number
  statusChanges: number
  inboundMessages: number
  outboundMessages: number
  /** Distinct days in the window on which anything at all happened. */
  activeDays: number
}

/**
 * Activity over the `days` ending at `endingDaysAgo` days before now.
 *
 * Two calls with different offsets give a period and its predecessor, which is
 * the only honest way to say "more" or "less" — a single window is a number, not
 * a trend. Deliberately returns COUNTS and never a verdict: whether a change is
 * meaningful depends on sample size, and that judgement belongs to the model
 * reasoning over the numbers, with the tool telling it how small the sample is.
 */
export async function getActivityWindow(
  s: SessionlessScope,
  opts: { days: number; endingDaysAgo?: number },
): Promise<ActivityWindow> {
  const plan = await getEffectiveLeadPlan(s.agencyId)
  const endOffset = opts.endingDaysAgo ?? 0
  const startOffset = endOffset + opts.days
  const leadIds = scopedLeads(s.agencyId, plan, s).select('id')

  const within = (col: string) =>
    db.raw(`${col} >= NOW() - make_interval(days => ?) AND ${col} < NOW() - make_interval(days => ?)`, [
      startOffset,
      endOffset,
    ])

  const [leads, transitions, messages, active] = await Promise.all([
    scopedLeads(s.agencyId, plan, s)
      .whereRaw(`"createdAt" >= NOW() - make_interval(days => ?) AND "createdAt" < NOW() - make_interval(days => ?)`, [
        startOffset,
        endOffset,
      ])
      .count<{ count: string }>('id as count')
      .first(),

    db('lead_status_transitions')
      .where('agencyId', s.agencyId)
      .whereIn('leadId', leadIds)
      .where(within('"occurredAt"'))
      .count<{ count: string }>('id as count')
      .first(),

    db('inbox_messages as m')
      .where('m.agencyId', s.agencyId)
      .whereIn('m.leadId', leadIds)
      .whereRaw(notHistorySql('m'))
      .where(within('COALESCE(m."channelTimestamp", m."createdAt")'))
      .select(
        db.raw(`COUNT(*) FILTER (WHERE m.direction = 'inbound')::int as inbound`),
        db.raw(`COUNT(*) FILTER (WHERE m.direction = 'outbound')::int as outbound`),
      )
      .first(),

    // A day counts as active if a lead arrived, a status moved, or a message
    // was exchanged — the three things that mean somebody worked.
    db
      .raw(
        `SELECT COUNT(DISTINCT d)::int AS days FROM (
           SELECT date_trunc('day', c."createdAt") AS d FROM clients c
             WHERE c."agencyId" = ? AND c."createdAt" >= NOW() - make_interval(days => ?) AND c."createdAt" < NOW() - make_interval(days => ?)
           UNION ALL
           SELECT date_trunc('day', t."occurredAt") FROM lead_status_transitions t
             WHERE t."agencyId" = ? AND t."occurredAt" >= NOW() - make_interval(days => ?) AND t."occurredAt" < NOW() - make_interval(days => ?)
           UNION ALL
           SELECT date_trunc('day', COALESCE(m."channelTimestamp", m."createdAt")) FROM inbox_messages m
             WHERE m."agencyId" = ? AND COALESCE(m."channelTimestamp", m."createdAt") >= NOW() - make_interval(days => ?)
               AND COALESCE(m."channelTimestamp", m."createdAt") < NOW() - make_interval(days => ?)
         ) AS s`,
        [
          s.agencyId, startOffset, endOffset,
          s.agencyId, startOffset, endOffset,
          s.agencyId, startOffset, endOffset,
        ],
      )
      .then((r: { rows?: { days?: number }[] }) => Number(r.rows?.[0]?.days ?? 0)),
  ])

  const msg = messages as { inbound?: number; outbound?: number } | undefined
  return {
    newLeads: Number(leads?.count ?? 0),
    statusChanges: Number(transitions?.count ?? 0),
    inboundMessages: Number(msg?.inbound ?? 0),
    outboundMessages: Number(msg?.outbound ?? 0),
    activeDays: active,
  }
}
