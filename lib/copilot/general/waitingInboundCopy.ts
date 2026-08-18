/**
 * Deterministic waiting-inbound copy. Waiting first — not a recency dump.
 */
import { formatInboundAgo, type RecentInboundSender } from './recentInboundCopy'

export function composeWaitingInboundAnswer(senders: RecentInboundSender[], nowMs = Date.now()): string {
  if (senders.length === 0) return 'אין כרגע שיחות וואטסאפ שממתינות למענה.'

  const lines = senders.map((s) => `• ${s.name} — ${formatInboundAgo(s.at, nowMs)}`)
  const head = 'מי שממתין למענה בוואטסאפ:'
  const insight =
    senders.length === 1
      ? `\n\n${senders[0].name} עדיין ממתין, אז הצעד הישיר הוא לענות.`
      : `\n\nאלה שיחות שכבר ממתינות — לא רשימת כל מי ששלח לאחרונה.`
  return `${head}\n${lines.join('\n')}${insight}`
}
