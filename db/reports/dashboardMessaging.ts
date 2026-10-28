import { db } from '@/config/db'
import { notHistorySql } from '@/lib/inbox/messageTimeline'
import { AUTO_RESPONSE_SOURCE, BUSINESS_TZ } from '@/lib/today/constants'
import type { Knex } from 'knex'

// Today dashboard — messaging facts (read-only). Callers pass `scopedIds`, a
// subquery of the lead ids the viewer may see, so every count here is
// permission-scoped exactly like the leads queries. Day keys are business days
// (Asia/Jerusalem); `fromKey` is the oldest key of the previous window.

const TS = (a: string) => `COALESCE(${a}."channelTimestamp", ${a}."createdAt")`
const DAY = (a: string) => `to_char(${TS(a)} AT TIME ZONE ?, 'YYYY-MM-DD')`

export type RepliedRow = { day: string; leadId: number }

/**
 * Leads that received a HUMAN reply, one row per (business day, lead).
 * WhatsApp: outbound, not imported history, not the auto-responder, not failed.
 * Messenger: every outbound is a person (CRM, Page inbox or another app).
 */
export async function getRepliedLeadDays(agencyId: number, scopedIds: Knex.QueryBuilder, fromKey: string) {
  const whatsapp = db('inbox_messages as m')
    .join('inbox_conversations as cv', 'cv.id', 'm.conversationId')
    .where('m.agencyId', agencyId)
    .where('m.direction', 'outbound')
    .whereNot('m.status', 'failed')
    .whereRaw(notHistorySql('m'))
    .whereRaw(`(m.metadata->>'source') IS DISTINCT FROM ?`, [AUTO_RESPONSE_SOURCE])
    .whereRaw(`${TS('m')} >= (?::date - 1)`, [fromKey])
    .whereIn('cv.leadId', scopedIds.clone())
    .select(db.raw(`${DAY('m')} AS day`, [BUSINESS_TZ]), 'cv.leadId as leadId')

  const messenger = db('messenger_messages as mm')
    .join('messenger_conversations as mc', 'mc.id', 'mm.conversationId')
    .where('mm.agencyId', agencyId)
    .where('mm.direction', 'outbound')
    .whereRaw(`${TS('mm')} >= (?::date - 1)`, [fromKey])
    .whereIn('mc.leadId', scopedIds.clone())
    .select(db.raw(`${DAY('mm')} AS day`, [BUSINESS_TZ]), 'mc.leadId as leadId')

  const rows = (await db
    .select('day', 'leadId')
    .from(whatsapp.union(messenger).as('r'))
    .where('day', '>=', fromKey)
    .groupBy('day', 'leadId')) as RepliedRow[]
  return rows.map((r) => ({ day: r.day, leadId: Number(r.leadId) }))
}

export type ResponseRow = { day: string; minutes: number; n: number }

/**
 * WhatsApp time to first human reply, per business day: for each conversation,
 * its first customer message of the day, then the first human reply after it.
 * Unanswered messages are not counted (they have no response time yet).
 */
export async function getResponseTimeByDay(agencyId: number, scopedIds: Knex.QueryBuilder, fromKey: string) {
  const firstInbound = db('inbox_messages as m')
    .join('inbox_conversations as cv', 'cv.id', 'm.conversationId')
    .where('m.agencyId', agencyId)
    .where('m.direction', 'inbound')
    .whereRaw(notHistorySql('m'))
    .whereRaw(`${TS('m')} >= (?::date - 1)`, [fromKey])
    .whereIn('cv.leadId', scopedIds.clone())
    .groupBy('m.conversationId', 'day')
    .select('m.conversationId as cid', db.raw(`${DAY('m')} AS day`, [BUSINESS_TZ]), db.raw(`MIN(${TS('m')}) AS t_in`))

  const rows = (await db
    .from(firstInbound.as('f'))
    .joinRaw(
      `CROSS JOIN LATERAL (
         SELECT MIN(${TS('o')}) AS t_out FROM inbox_messages o
         WHERE o."conversationId" = f.cid AND o.direction = 'outbound' AND o.status <> 'failed'
           AND ${notHistorySql('o')} AND (o.metadata->>'source') IS DISTINCT FROM ?
           AND ${TS('o')} > f.t_in
       ) r`,
      [AUTO_RESPONSE_SOURCE],
    )
    .whereNotNull('r.t_out')
    .where('f.day', '>=', fromKey)
    .groupBy('f.day')
    .select(
      'f.day as day',
      db.raw(`AVG(EXTRACT(EPOCH FROM (r.t_out - f.t_in)) / 60)::float AS minutes`),
      db.raw('COUNT(*)::int AS n'),
    )) as ResponseRow[]
  return rows.map((r) => ({ day: r.day, minutes: Number(r.minutes), n: Number(r.n) }))
}
