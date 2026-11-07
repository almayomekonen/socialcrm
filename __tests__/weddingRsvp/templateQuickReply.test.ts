import { describe, it, expect, vi, afterEach } from 'vitest'

/** sendWhatsappTemplate builds quick-reply payload components; other templates are unchanged. No network. */

const { sendWhatsappTemplate } = await import('@/lib/whatsapp/sendTemplateMessage')

function captureFetch() {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.Q' }] }), { status: 200 })
  }))
  return bodies
}
const base = { phoneNumberId: 'PN', accessToken: 't', to: '972500000001', language: 'he', params: [] as string[], consent: { kind: 'manual_reply' as const, agencyId: 1, userId: 1 } }

describe('sendWhatsappTemplate quick-reply payloads', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('adds one button component per payload, in order', async () => {
    const bodies = captureFetch()
    await sendWhatsappTemplate({ ...base, name: 'wedding_rsvp', quickReplyPayloads: ['wedding_rsvp_attending', 'wedding_rsvp_not_attending'] })
    expect((bodies[0].template as { components: unknown[] }).components).toEqual([
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'wedding_rsvp_attending' }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'wedding_rsvp_not_attending' }] },
    ])
  })

  it('the invite payload (image header, no buttons) is exactly as before', async () => {
    const bodies = captureFetch()
    await sendWhatsappTemplate({ ...base, name: 'wedding_invite', headerImage: { link: 'https://x/y.jpg' } })
    expect((bodies[0].template as { components: unknown[] }).components).toEqual([{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://x/y.jpg' } }] }])
  })
})
