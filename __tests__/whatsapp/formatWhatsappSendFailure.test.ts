import { describe, it, expect } from 'vitest'
import { formatWhatsappSendFailure } from '@/lib/whatsapp/sendMessage'

describe('formatWhatsappSendFailure', () => {
  it('includes http, code, subcode, type, fbtrace, and message', () => {
    const s = formatWhatsappSendFailure({
      ok: false,
      error: '(#131030) Recipient phone number not in allowed list',
      code: '131030',
      subcode: '2494055',
      httpStatus: 400,
      type: 'OAuthException',
      fbtraceId: 'AbCdEf',
    })
    expect(s).toContain('whatsapp_send_failed')
    expect(s).toContain('http=400')
    expect(s).toContain('code=131030')
    expect(s).toContain('subcode=2494055')
    expect(s).toContain('type=OAuthException')
    expect(s).toContain('fbtrace=AbCdEf')
    expect(s).toContain('Recipient phone number not in allowed list')
  })

  it('works for network failures without http/code', () => {
    const s = formatWhatsappSendFailure({ ok: false, error: 'fetch failed' })
    expect(s).toBe('whatsapp_send_failed message=fetch failed')
  })
})
