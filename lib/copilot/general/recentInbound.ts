import type { Scope } from '@/db/briefing'
import type { Roles } from '@/types/roles'
import { composeRecentInboundAnswer, type RecentInboundSender } from './recentInboundCopy'
import { composeWaitingInboundAnswer } from './waitingInboundCopy'
import { listWaitingWhatsappRows } from './waitingInbound'
import { listRecentWhatsappInboundRows } from './recentInboundQuery'

export type RecentInboundPayload = {
  senders: RecentInboundSender[]
  answer: string
}

type InboxActor = { agencyId: number; id: number; role: Roles }

function toSenders(rows: { name: string | null; lastInboundAt: string }[]): RecentInboundSender[] {
  return rows.map((r) => ({
    name: r.name?.trim() || 'ליד ללא שם',
    at: r.lastInboundAt,
  }))
}

/** Newest inbound first — includes answered conversations. */
export async function loadRecentInboundWhatsapp(user: InboxActor, scope: Scope): Promise<RecentInboundPayload> {
  const senders = toSenders(await listRecentWhatsappInboundRows(user, scope))
  return { senders, answer: composeRecentInboundAnswer(senders) }
}

/** Oldest waiting first — ball-in-court only, not recency and not unread. */
export async function loadWaitingInboundWhatsapp(user: InboxActor, scope: Scope): Promise<RecentInboundPayload> {
  const senders = toSenders(await listWaitingWhatsappRows(user, scope, 'asc'))
  return { senders, answer: composeWaitingInboundAnswer(senders) }
}
