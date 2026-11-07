import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'

const okResponse = () =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ messages: [{ id: 'wamid.TEST' }] }),
  }) as unknown as Response

describe('sendWhatsappText — recipient normalization at the boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes an Israeli local number in the Graph request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
    await sendWhatsappText({ phoneNumberId: '1216762448189306', accessToken: 't', to: '0537736636', body: 'x', consent: { kind: 'manual_reply' as const, agencyId: 1, userId: 1 } })
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.to).toBe('972537736636')
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/1216762448189306/messages')
  })

  it('leaves an already-E.164 number unchanged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
    await sendWhatsappText({ phoneNumberId: '1216762448189306', accessToken: 't', to: '972535317356', body: 'x', consent: { kind: 'manual_reply' as const, agencyId: 1, userId: 1 } })
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.to).toBe('972535317356')
  })
})
