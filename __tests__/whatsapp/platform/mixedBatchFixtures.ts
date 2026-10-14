import { createHmac } from 'crypto'
import { db } from '@/config/db'

/**
 * Signed delivery builders and the agency side-effect counter shared by the
 * mixed-delivery webhook tests (`webhookMixedBatch.db.test.ts`). Pure, except
 * `agencySideEffects`, which only reads.
 */

export const SECRET = 'test-app-secret-mixed'
export const PLATFORM = '1000000000001'
export const PN_A = '__mixed_pn_a'
export const OWNER = '972500000081'
export const CUSTOMER = '972500000082'

export function signed(body: unknown): Request {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex')
  return new Request('https://getsocialcrm.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
    body: raw,
  })
}

export const entry = (id: string, field: string, value: Record<string, unknown>) => ({ id, changes: [{ field, value }] })
export const agencyInbound = (wamid: string) =>
  entry('WABA_A', 'messages', {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000001', phone_number_id: PN_A },
    contacts: [{ profile: { name: 'לקוח' }, wa_id: CUSTOMER }],
    messages: [{ from: CUSTOMER, id: wamid, timestamp: '1760000000', type: 'text', text: { body: 'שלום, אפשר פרטים?' } }],
  })
export const agencyEcho = (wamid: string) =>
  entry('WABA_A', 'smb_message_echoes', {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000001', phone_number_id: PN_A },
    message_echoes: [{ from: '15550000001', to: CUSTOMER, id: wamid, timestamp: '1760000000', type: 'text', text: { body: 'תשובה מהטלפון' } }],
  })
export const agencyHistory = () => entry('WABA_A', 'history', { messaging_product: 'whatsapp', metadata: { phone_number_id: PN_A }, history: [] })
// Default send time is shared on purpose; a test that must ACTIVATE after earlier
// opt-outs from the same fake number passes a later one (a tie goes to the opt-out).
export const platformMessage = (wamid: string, body: string, ts = 1_760_000_100) =>
  entry('WABA_PLATFORM', 'messages', {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000099', phone_number_id: PLATFORM },
    messages: [{ from: OWNER, id: wamid, timestamp: String(ts), type: 'text', text: { body } }],
  })
export const delivery = (...entries: unknown[]) => ({ object: 'whatsapp_business_account', entry: entries })
export const agencyStatus = (wamid: string, status: string) =>
  entry('WABA_A', 'messages', {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000001', phone_number_id: PN_A },
    statuses: [{ id: wamid, status, timestamp: '1760000300', recipient_id: CUSTOMER }],
  })
export const agencyTemplateStatus = () =>
  entry('WABA_A', 'message_template_status_update', { event: 'APPROVED', message_template_id: 1, message_template_name: '__mixed_tpl', message_template_language: 'he' })
export const platformStatus = (wamid: string) =>
  entry('WABA_PLATFORM', 'messages', {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000099', phone_number_id: PLATFORM },
    statuses: [{ id: wamid, status: 'delivered', timestamp: '1760000300', recipient_id: OWNER }],
  })
export const platformEcho = (wamid: string) =>
  entry('WABA_PLATFORM', 'smb_message_echoes', {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000099', phone_number_id: PLATFORM },
    message_echoes: [{ from: '15550000099', to: OWNER, id: wamid, timestamp: '1760000300', type: 'text', text: { body: 'x' } }],
  })


/** Every agency-side table a delivery can write to, for one agency. */
export async function agencySideEffects(agencyA: number) {
  const scoped = async (t: string) => Number((await db(t).where({ agencyId: agencyA }).count<{ c: string }>('* as c').first())?.c ?? 0)
  const tables = ['inbox_conversations', 'inbox_messages', 'clients', 'auto_response_jobs', 'notifications', 'notification_jobs', 'tasks', 'conversation_ai_state', 'analytics_events']
  const out: Record<string, number> = {}
  for (const t of tables) {
    const cols = await db(t).columnInfo().catch(() => ({}))
    out[t] = 'agencyId' in cols ? await scoped(t) : -1
  }
  return out
}
