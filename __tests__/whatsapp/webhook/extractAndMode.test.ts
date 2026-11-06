import { describe, expect, it, vi } from 'vitest'
import { extractWhatsappWebhook } from '@/lib/whatsapp/webhook/extract'
import { logDirectModeActive, whatsappWebhookMode } from '@/lib/whatsapp/webhook/mode'

const meta = (phone = 'PN1') => ({ messaging_product: 'whatsapp', metadata: { phone_number_id: phone } })
const msg = (id: string, from = '972500000001') => ({ id, from, type: 'text', text: { body: 'x' } })

describe('the kill switch', () => {
  it('is durable unless WA_WEBHOOK_DIRECT_PROCESSING is exactly "1"', () => {
    expect(whatsappWebhookMode({})).toBe('durable')
    expect(whatsappWebhookMode({ WA_WEBHOOK_DIRECT_PROCESSING: '' })).toBe('durable')
    expect(whatsappWebhookMode({ WA_WEBHOOK_DIRECT_PROCESSING: '0' })).toBe('durable')
    expect(whatsappWebhookMode({ WA_WEBHOOK_DIRECT_PROCESSING: 'true' })).toBe('durable')
    expect(whatsappWebhookMode({ WA_WEBHOOK_DIRECT_PROCESSING: '1' })).toBe('direct')
    expect(whatsappWebhookMode({ WA_WEBHOOK_DIRECT_PROCESSING: ' 1 ' })).toBe('direct')
  })

  it('emits the alert line with counts only', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    logDirectModeActive('cron')
    logDirectModeActive('webhook', { events: 2 })
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['[wa-webhook] direct_mode_active', '[wa-webhook] direct_mode_active'])
    expect(JSON.parse(spy.mock.calls[1][1] as string)).toEqual({ where: 'webhook', events: 2 })
    spy.mockRestore()
  })
})

describe('extracting events from a signed payload', () => {
  it('reads EVERY entry and EVERY change, in payload order', () => {
    const body = {
      entry: [
        { id: 'W1', changes: [{ field: 'messages', value: { ...meta(), messages: [msg('wamid.1'), msg('wamid.2')] } }, { field: 'messages', value: { ...meta(), messages: [msg('wamid.3')] } }] },
        { id: 'W2', changes: [{ field: 'messages', value: { ...meta('PN2'), messages: [msg('wamid.4', '972500000002')] } }] },
      ],
    }
    const { events } = extractWhatsappWebhook(body)
    expect(events.map((e) => e.eventKey)).toEqual(['msg:wamid.1', 'msg:wamid.2', 'msg:wamid.3', 'msg:wamid.4'])
    expect(events.map((e) => e.phoneNumberId)).toEqual(['PN1', 'PN1', 'PN1', 'PN2'])
    expect(events.map((e) => e.orderingKey)).toEqual(['972500000001', '972500000001', '972500000001', '972500000002'])
  })

  it('keys statuses by id, status and timestamp, with no ordering key', () => {
    const { events } = extractWhatsappWebhook({
      entry: [{ changes: [{ field: 'messages', value: { ...meta(), statuses: [{ id: 'wamid.S', status: 'delivered', timestamp: '100' }, { id: 'wamid.S', status: 'read', timestamp: '101' }] } }] }],
    })
    expect(events.map((e) => [e.kind, e.eventKey, e.orderingKey])).toEqual([
      ['status', 'st:wamid.S:delivered:100', null],
      ['status', 'st:wamid.S:read:101', null],
    ])
  })

  it('makes echoes their own kind, ordered by the customer they were sent to, never inbound', () => {
    const { events } = extractWhatsappWebhook({
      entry: [{ changes: [{ field: 'smb_message_echoes', value: { ...meta(), message_echoes: [{ id: 'wamid.E', from: 'BIZ', to: '972500000001' }], messages: [msg('wamid.NOT')] } }] }],
    })
    expect(events.map((e) => [e.kind, e.eventKey, e.orderingKey])).toEqual([['echo', 'echo:wamid.E', '972500000001']])
  })

  it('keeps history, app-state sync, account and template updates inline, in both modes', () => {
    const fields = ['history', 'smb_app_state_sync', 'account_update', 'message_template_status_update', 'message_template_quality_update']
    const { events, inline } = extractWhatsappWebhook({ entry: [{ id: 'W', changes: fields.map((field) => ({ field, value: meta() })) }] })
    expect(events).toEqual([])
    expect(inline.map((c) => c.field)).toEqual(fields)
  })

  it('skips malformed items without dropping their siblings, and never uses the payload for tenancy', () => {
    const { events, skipped } = extractWhatsappWebhook({
      entry: [
        { changes: [{ field: 'messages', value: { ...meta(), messages: [{ id: 'wamid.nofrom' }, msg('wamid.ok')], statuses: [{ status: 'read' }] } }] },
        { changes: [{ field: 'messages', value: { messages: [msg('wamid.nophone')] } }] },
        { changes: [{ field: 'messages', value: { ...meta(), agencyId: 999, messages: [msg('wamid.x')] } }] },
      ],
    })
    expect(events.map((e) => e.eventKey)).toEqual(['msg:wamid.ok', 'msg:wamid.x'])
    expect(skipped).toBe(3)
    expect(events.every((e) => !('agencyId' in e))).toBe(true)
  })

  it('takes the profile name of the matching sender, not simply the first contact', () => {
    const { events } = extractWhatsappWebhook({
      entry: [{ changes: [{ field: 'messages', value: { ...meta(), contacts: [{ wa_id: 'A', profile: { name: 'Ann' } }, { wa_id: 'B', profile: { name: 'Bob' } }], messages: [msg('wamid.b', 'B')] } }] }],
    })
    expect((events[0].payload as { profileName: string }).profileName).toBe('Bob')
  })

  it('tolerates garbage bodies', () => {
    for (const body of [null, {}, { entry: 'x' }, { entry: [{ changes: 'y' }] }, { entry: [null] }]) {
      expect(extractWhatsappWebhook(body).events).toEqual([])
    }
  })
})
