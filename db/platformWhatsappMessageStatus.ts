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

/** Meta's `pricing` object (status webhooks, R3). It carries no amount: rates come from platform_whatsapp_rate_cards. */
export type PlatformStatusPricing = { model: string | null; type: string | null; category: string | null; billable: boolean | null }

export type PlatformStatusEvent = {
  wamid: string
  status: keyof typeof TS_COLUMN
  at: Date
  errorCode: string | null
  pricing?: PlatformStatusPricing | null
}

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null)

export function parsePlatformStatus(raw: unknown): PlatformStatusEvent | null {
  const s = raw as { id?: unknown; status?: unknown; timestamp?: unknown; errors?: { code?: unknown }[]; pricing?: Record<string, unknown> } | null
  const wamid = typeof s?.id === 'string' && s.id ? s.id : null
  const status = typeof s?.status === 'string' && s.status in TS_COLUMN ? (s.status as keyof typeof TS_COLUMN) : null
  const secs = typeof s?.timestamp === 'string' && /^\d{1,12}$/.test(s.timestamp) ? Number(s.timestamp) : NaN
  if (!wamid || !status) return null
  const code = s?.errors?.[0]?.code
  const p = s?.pricing && typeof s.pricing === 'object' ? s.pricing : null
  const pricing = p
    ? { model: str(p.pricing_model), type: str(p.type), category: str(p.category), billable: typeof p.billable === 'boolean' ? p.billable : null }
    : null
  return { wamid, status, at: Number.isFinite(secs) ? new Date(secs * 1000) : new Date(), errorCode: code == null ? null : String(code), pricing }
}

export async function recordPlatformStatus(e: PlatformStatusEvent): Promise<void> {
  const col = TS_COLUMN[e.status]
  await db.raw(
    `INSERT INTO owner_whatsapp_message_status (wamid, status, "${col}", "errorCode",
        "pricingModel", "pricingType", "pricingCategory", "pricingBillable", "pricingRecordedAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN now() ELSE NULL END, now())
     ON CONFLICT (wamid) DO UPDATE SET
       status = CASE WHEN owner_whatsapp_message_status.status = 'failed' THEN 'failed'
                     WHEN ${RANK_SQL('EXCLUDED.status')} > ${RANK_SQL('owner_whatsapp_message_status.status')} THEN EXCLUDED.status
                     ELSE owner_whatsapp_message_status.status END,
       "${col}" = COALESCE(owner_whatsapp_message_status."${col}", EXCLUDED."${col}"),
       "errorCode" = COALESCE(owner_whatsapp_message_status."errorCode", EXCLUDED."errorCode"),
       -- Pricing is recorded once: the first webhook that carries it wins.
       "pricingModel" = COALESCE(owner_whatsapp_message_status."pricingModel", EXCLUDED."pricingModel"),
       "pricingType" = COALESCE(owner_whatsapp_message_status."pricingType", EXCLUDED."pricingType"),
       "pricingCategory" = COALESCE(owner_whatsapp_message_status."pricingCategory", EXCLUDED."pricingCategory"),
       "pricingBillable" = COALESCE(owner_whatsapp_message_status."pricingBillable", EXCLUDED."pricingBillable"),
       "pricingRecordedAt" = COALESCE(owner_whatsapp_message_status."pricingRecordedAt", EXCLUDED."pricingRecordedAt"),
       "updatedAt" = now()`,
    [
      e.wamid, e.status, e.at, e.errorCode,
      e.pricing?.model ?? null, e.pricing?.type ?? null, e.pricing?.category ?? null, e.pricing?.billable ?? null,
      !!e.pricing,
    ],
  )
}
