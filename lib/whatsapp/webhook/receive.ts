import { db } from '@/config/db'
import { recordWhatsappEvents } from '@/db/whatsappWebhookEvents'
import { processAccountUpdate } from '@/lib/whatsapp/accountUpdate'
import { processCoexistenceWebhook } from '@/lib/whatsapp/coexistence'
import { ingestTemplateStatusUpdate } from '@/lib/whatsapp/templates/ingestStatus'
import { extractWhatsappWebhook } from './extract'
import { logDirectModeActive, type WhatsappWebhookMode } from './mode'
import { processWhatsappEvent } from './processEvent'

/**
 * The webhook's whole job for an agency payload (signature already verified):
 *
 *   durable  record one receipt per event, then acknowledge. 200 only after the insert
 *            commits; a failed insert is 503 so Meta redelivers. Never falls back to
 *            direct processing: that would acknowledge without a durable record.
 *   direct   (kill switch) apply each event inside the request with the same function
 *            the worker uses; 503 if any event did not commit.
 *
 * In both modes: inline fields keep their previous handling, a phone number with no
 * connection is acknowledged and ignored (a retry would give the same answer), and
 * nothing here logs a phone number, a customer id or message content.
 */

export type ReceiveResult = {
  status: 200 | 503
  mode: WhatsappWebhookMode
  recordedIds: number[]
  kick: boolean
  delaySeconds: number
  counts: { events: number; recorded: number; duplicates: number; processed: number; failed: number; unknownNumber: number; skipped: number }
}

async function handleInline(field: string, entryId: unknown, value: unknown): Promise<boolean> {
  if (field === 'history' || field === 'smb_app_state_sync') {
    const r = await processCoexistenceWebhook(field, value)
    if (!r.ok) console.error('[wa-webhook] coexistence not acknowledged', JSON.stringify({ field, reason: r.reason ?? null }))
    return r.ok
  }
  if (field === 'account_update') {
    try {
      await processAccountUpdate(entryId as never, value as never)
    } catch (err) {
      console.error('[wa-webhook] account_update failed', JSON.stringify({ name: (err as Error)?.name ?? null }))
    }
    return true
  }
  try {
    await ingestTemplateStatusUpdate(entryId as never, field as never, value as never)
  } catch (err) {
    console.error('[wa-webhook] template update failed', JSON.stringify({ name: (err as Error)?.name ?? null }))
  }
  return true
}

export async function receiveWhatsappWebhook(body: unknown, mode: WhatsappWebhookMode): Promise<ReceiveResult> {
  const extracted = extractWhatsappWebhook(body)
  const counts = { events: extracted.events.length, recorded: 0, duplicates: 0, processed: 0, failed: 0, unknownNumber: 0, skipped: extracted.skipped }
  const result: ReceiveResult = { status: 200, mode, recordedIds: [], kick: false, delaySeconds: Number.POSITIVE_INFINITY, counts }

  for (const change of extracted.inline) {
    if (!(await handleInline(change.field, change.entryId, change.value))) result.status = 503
  }

  if (extracted.events.length > 0) {
    // Tenancy for the whole delivery in one query, from the signed phone_number_id only.
    const phoneIds = [...new Set(extracted.events.map((e) => e.phoneNumberId))]
    let agencyByPhone: Map<string, number>
    try {
      const rows = (await db('whatsapp_connections').whereIn('phone_number_id', phoneIds).select('phone_number_id', 'agency_id')) as {
        phone_number_id: string
        agency_id: number
      }[]
      agencyByPhone = new Map(rows.map((r) => [String(r.phone_number_id), Number(r.agency_id)]))
    } catch (err) {
      console.error('[wa-webhook] tenant lookup failed; not acknowledged', JSON.stringify({ name: (err as Error)?.name ?? null }))
      return { ...result, status: 503, delaySeconds: 0 }
    }
    const known = extracted.events.filter((e) => agencyByPhone.has(e.phoneNumberId))
    counts.unknownNumber = extracted.events.length - known.length

    if (mode === 'durable') {
      try {
        const r = await recordWhatsappEvents(known.map((e) => ({ ...e, agencyId: agencyByPhone.get(e.phoneNumberId) as number })))
        result.recordedIds = r.insertedIds
        counts.recorded = r.insertedIds.length
        counts.duplicates = r.duplicates
      } catch (err) {
        console.error('[wa-webhook] receipt write failed; not acknowledged', JSON.stringify({ name: (err as Error)?.name ?? null, events: known.length }))
        return { ...result, status: 503, delaySeconds: 0 }
      }
    } else {
      logDirectModeActive('webhook', { events: known.length })
      for (const e of known) {
        try {
          const r = await processWhatsappEvent({ agencyId: agencyByPhone.get(e.phoneNumberId) as number, phoneNumberId: e.phoneNumberId, kind: e.kind, payload: e.payload })
          counts.processed++
          if (r.kick) {
            result.kick = true
            result.delaySeconds = Math.min(result.delaySeconds, r.delaySeconds)
          }
        } catch (err) {
          counts.failed++
          console.error('[wa-webhook] direct event failed; not acknowledged', JSON.stringify({ kind: e.kind, name: (err as Error)?.name ?? null, code: (err as { code?: string })?.code ?? null }))
        }
      }
      if (counts.failed > 0) result.status = 503
    }
  }

  if (!Number.isFinite(result.delaySeconds)) result.delaySeconds = 0
  console.log('[wa-webhook] received', JSON.stringify({ mode, status: result.status, ...counts }))
  return result
}
