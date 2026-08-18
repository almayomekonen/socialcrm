/**
 * Deterministic answer for recent inbound WhatsApp. Names + recency only.
 * Does not claim the conversation is waiting or unread.
 */
export type RecentInboundSender = { name: string; at: string }

export function formatInboundAgo(iso: string, nowMs = Date.now()): string {
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at) || at > nowMs) return 'לאחרונה'
  const minutes = Math.max(0, Math.round((nowMs - at) / 60_000))
  if (minutes < 1) return 'לפני רגע'
  if (minutes === 1) return 'לפני דקה'
  if (minutes < 60) return `לפני ${minutes} דקות`
  const hours = Math.round(minutes / 60)
  if (hours === 1) return 'לפני שעה'
  if (hours < 24) return `לפני ${hours} שעות`
  const days = Math.round(hours / 24)
  return days === 1 ? 'אתמול' : `לפני ${days} ימים`
}

export function composeRecentInboundAnswer(senders: RecentInboundSender[], nowMs = Date.now()): string {
  if (senders.length === 0) return 'אין כרגע הודעות וואטסאפ נכנסות לאחרונה.'

  const lines = senders.map((s) => `• ${s.name} — ${formatInboundAgo(s.at, nowMs)}`)
  return `מי ששלח הודעה בוואטסאפ לאחרונה:\n${lines.join('\n')}`
}
