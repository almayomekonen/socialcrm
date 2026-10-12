import { db } from '@/config/db'

/**
 * owner_whatsapp_message_status: Meta's delivery statuses for messages sent
 * from the platform number, keyed by message id. Order-independent: a status
 * that arrives before the send result is saved is kept, and joins later by
 * wamid. Statuses only move forward (sent < delivered < read); `failed` is
 * terminal. Each timestamp is set once, from Meta's own event time.
 */

const RANK_SQL = (col: string) => `CASE ${col} WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END`
const TS_COLUMN = { sent: 'sentAt', delivered: 'deliveredAt', read: 'readAt', failed: 'failedAt' } as const

export type PlatformStatusEvent = { wamid: string; status: keyof typeof TS_COLUMN; at: Date; errorCode: string | null }

export function parsePlatformStatus(raw: unknown): PlatformStatusEvent | null {
  const s = raw as { id?: unknown; status?: unknown; timestamp?: unknown; errors?: { code?: unknown }[] } | null
  const wamid = typeof s?.id === 'string' && s.id ? s.id : null
  const status = typeof s?.status === 'string' && s.status in TS_COLUMN ? (s.status as keyof typeof TS_COLUMN) : null
  const secs = typeof s?.timestamp === 'string' && /^\d{1,12}$/.test(s.timestamp) ? Number(s.timestamp) : NaN
  if (!wamid || !status) return null
  const code = s?.errors?.[0]?.code
  return { wamid, status, at: Number.isFinite(secs) ? new Date(secs * 1000) : new Date(), errorCode: code == null ? null : String(code) }
}

export async function recordPlatformStatus(e: PlatformStatusEvent): Promise<void> {
  const col = TS_COLUMN[e.status]
  await db.raw(
    `INSERT INTO owner_whatsapp_message_status (wamid, status, "${col}", "errorCode", "updatedAt")
     VALUES (?, ?, ?, ?, now())
     ON CONFLICT (wamid) DO UPDATE SET
       status = CASE WHEN owner_whatsapp_message_status.status = 'failed' THEN 'failed'
                     WHEN ${RANK_SQL('EXCLUDED.status')} > ${RANK_SQL('owner_whatsapp_message_status.status')} THEN EXCLUDED.status
                     ELSE owner_whatsapp_message_status.status END,
       "${col}" = COALESCE(owner_whatsapp_message_status."${col}", EXCLUDED."${col}"),
       "errorCode" = COALESCE(owner_whatsapp_message_status."errorCode", EXCLUDED."errorCode"),
       "updatedAt" = now()`,
    [e.wamid, e.status, e.at, e.errorCode],
  )
}
