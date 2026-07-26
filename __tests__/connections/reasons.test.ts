/**
 * Guards that every structured reason code maps to a notice the UI can render
 * (an approved message key, or an intentionally-silent WhatsApp code). Prevents
 * a new reason from silently pointing at nothing.
 */
import { describe, it, expect } from 'vitest'
import { FB_REASON, WA_REASON, FB_REASON_NOTICE_CODE, WA_REASON_NOTICE_CODE } from '@/lib/connections/reasons'
import { FACEBOOK_NOTICES, WHATSAPP_NOTICES } from '@/lib/connections/messages'

// WhatsApp codes that are handled by whatsappNotice() returning null on purpose.
const WA_SILENT = new Set(['denied', 'cancelled'])

describe('connection reason codes', () => {
  it('every Facebook reason maps to an existing approved notice', () => {
    for (const reason of Object.values(FB_REASON)) {
      const code = FB_REASON_NOTICE_CODE[reason]
      expect(code, `FB reason ${reason} has no notice code`).toBeTruthy()
      expect(FACEBOOK_NOTICES[code], `FB notice '${code}' missing from catalog`).toBeTruthy()
    }
  })

  it('every WhatsApp reason maps to an existing notice or an intentional silent code', () => {
    for (const reason of Object.values(WA_REASON)) {
      const code = WA_REASON_NOTICE_CODE[reason]
      expect(code, `WA reason ${reason} has no notice code`).toBeTruthy()
      const known = Boolean(WHATSAPP_NOTICES[code]) || WA_SILENT.has(code)
      expect(known, `WA notice '${code}' missing from catalog`).toBe(true)
    }
  })
})
