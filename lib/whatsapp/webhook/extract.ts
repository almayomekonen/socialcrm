import type { WhatsappEventKind } from '@/db/whatsappWebhookEvents'

/**
 * A signed agency payload → the events that need durable handling, plus the changes
 * that keep their existing inline handling. EVERY entry and EVERY change is read (the
 * route used to read only `entry[0].changes[0]`).
 *
 * Durable, one event each, in payload order:
 *   message  `messages[]` items   key msg:<wamid>   ordered by the sender (customer)
 *   echo     `smb_message_echoes` key echo:<wamid>  ordered by the recipient (customer)
 *   status   `statuses[]` items   key st:<wamid>:<status>:<timestamp>   unordered
 *
 * Inline, unchanged in both modes: coexistence `history` (already durable on its own)
 * and `smb_app_state_sync`, `account_update`, and template status/quality updates.
 * Pure: no I/O. Tenancy is resolved later, from `metadata.phone_number_id` only.
 */

export type ExtractedEvent = {
  phoneNumberId: string
  kind: WhatsappEventKind
  eventKey: string
  orderingKey: string | null
  payload: unknown
}

export type InlineChange = { field: string; entryId: unknown; value: unknown }

export type Extracted = { events: ExtractedEvent[]; inline: InlineChange[]; skipped: number }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

const INLINE_FIELDS = new Set(['history', 'smb_app_state_sync', 'account_update', 'message_template_status_update', 'message_template_quality_update'])

function profileNameFor(value: Record<string, unknown>, waId: string): string | null {
  const contacts = Array.isArray(value.contacts) ? (value.contacts as Record<string, unknown>[]) : []
  const match = contacts.find((c) => c?.wa_id === waId) ?? (contacts.length === 1 ? contacts[0] : undefined)
  const name = (match?.profile as { name?: unknown } | undefined)?.name
  return typeof name === 'string' ? name : null
}

export function extractWhatsappWebhook(body: unknown): Extracted {
  const out: Extracted = { events: [], inline: [], skipped: 0 }
  const entries = Array.isArray((body as { entry?: unknown })?.entry) ? ((body as { entry: unknown[] }).entry as Record<string, unknown>[]) : []
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? (entry.changes as Record<string, unknown>[]) : []
    for (const change of changes) {
      const field = str(change?.field) ?? 'messages'
      const value = (change?.value ?? null) as Record<string, unknown> | null
      if (INLINE_FIELDS.has(field)) {
        out.inline.push({ field, entryId: entry?.id, value })
        continue
      }
      const phoneNumberId = str((value?.metadata as { phone_number_id?: unknown } | undefined)?.phone_number_id)
      if (!value || !phoneNumberId) {
        out.skipped++
        continue
      }
      if (field === 'smb_message_echoes') {
        for (const echo of Array.isArray(value.message_echoes) ? (value.message_echoes as Record<string, unknown>[]) : []) {
          const id = str(echo?.id)
          const to = str(echo?.to)
          if (!id || !to) {
            out.skipped++
            continue
          }
          out.events.push({ phoneNumberId, kind: 'echo', eventKey: `echo:${id}`, orderingKey: to, payload: { metadata: value.metadata, message_echoes: [echo] } })
        }
        continue
      }
      for (const status of Array.isArray(value.statuses) ? (value.statuses as Record<string, unknown>[]) : []) {
        const id = str(status?.id)
        if (!id) {
          out.skipped++
          continue
        }
        const key = `st:${id}:${str(status?.status) ?? ''}:${str(status?.timestamp) ?? ''}`
        out.events.push({ phoneNumberId, kind: 'status', eventKey: key, orderingKey: null, payload: { status } })
      }
      for (const message of Array.isArray(value.messages) ? (value.messages as Record<string, unknown>[]) : []) {
        const id = str(message?.id)
        const from = str(message?.from)
        if (!id || !from) {
          out.skipped++
          continue
        }
        out.events.push({ phoneNumberId, kind: 'message', eventKey: `msg:${id}`, orderingKey: from, payload: { message, profileName: profileNameFor(value, from) } })
      }
    }
  }
  return out
}
