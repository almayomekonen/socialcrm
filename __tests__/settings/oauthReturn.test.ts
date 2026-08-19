import { describe, expect, it } from 'vitest'
import {
  calendarReturnCopy,
  facebookReturnCopy,
  parseOAuthReturnQuery,
  resolveMobileIntegrationSheet,
  shouldAutoCompleteFacebook,
  shouldAutoCompleteWhatsapp,
  whatsappReturnCopy,
} from '@/modules/settings/mobile/oauthReturn'
import { FACEBOOK_NOTICES } from '@/lib/connections/messages'

describe('parseOAuthReturnQuery', () => {
  it('reads the callback keys the existing routes already write', () => {
    expect(
      parseOAuthReturnQuery({
        select: '1',
        error: 'denied',
        wa_error: 'token',
        gcal: 'connected',
        gdrive_error: 'denied',
      }),
    ).toEqual({
      section: null,
      select: '1',
      error: 'denied',
      wa_error: 'token',
      gcal: 'connected',
      gcal_error: null,
      gdrive: null,
      gdrive_error: 'denied',
    })
  })
})

describe('resolveMobileIntegrationSheet', () => {
  it('opens Facebook on select=1 even when a leftover WhatsApp cookie exists', () => {
    expect(
      resolveMobileIntegrationSheet({
        query: { select: '1' },
        pendingPages: [{ id: 'p1' }],
        pendingPhones: [{ id: 'ph1' }],
      }),
    ).toBe('facebook')
  })

  it('opens Facebook when pending pages exist with no query', () => {
    expect(
      resolveMobileIntegrationSheet({
        query: {},
        pendingPages: [{ id: 'p1' }],
        pendingPhones: null,
      }),
    ).toBe('facebook')
  })

  it('opens WhatsApp on wa_error and on pending phones', () => {
    expect(
      resolveMobileIntegrationSheet({
        query: { wa_error: 'token' },
        pendingPages: null,
        pendingPhones: null,
      }),
    ).toBe('whatsapp')
    expect(
      resolveMobileIntegrationSheet({
        query: {},
        pendingPages: null,
        pendingPhones: [{ id: 'ph1' }],
      }),
    ).toBe('whatsapp')
  })

  it('opens Calendar and Drive from their callback params', () => {
    expect(
      resolveMobileIntegrationSheet({
        query: { gcal: 'connected' },
        pendingPages: null,
        pendingPhones: null,
      }),
    ).toBe('calendar')
    expect(
      resolveMobileIntegrationSheet({
        query: { gdrive_error: 'denied' },
        pendingPages: null,
        pendingPhones: null,
      }),
    ).toBe('drive')
  })

  it('does not invent a sheet when nothing is returning', () => {
    expect(
      resolveMobileIntegrationSheet({ query: {}, pendingPages: null, pendingPhones: null }),
    ).toBeNull()
  })
})

describe('facebookReturnCopy', () => {
  it('never keeps the silent Connect label when pages are pending', () => {
    const copy = facebookReturnCopy({
      pendingPages: [{ id: '1' }, { id: '2' }],
      error: null,
      select: true,
      completing: false,
    })
    expect(copy?.actionLabel).toBe('השלימו חיבור')
    expect(copy?.actionLabel).not.toBe('חבר פייסבוק')
    expect(copy?.statusLabel).toBe('בחירת דף')
  })

  it('uses the approved denied notice', () => {
    const copy = facebookReturnCopy({
      pendingPages: null,
      error: 'denied',
      select: false,
      completing: false,
    })
    expect(copy?.statusLabel).toBe(FACEBOOK_NOTICES.denied.title)
    expect(copy?.role).toBe('error')
  })

  it('does not spin forever when select=1 arrived without pages', () => {
    const copy = facebookReturnCopy({
      pendingPages: null,
      error: null,
      select: true,
      completing: false,
    })
    expect(copy?.statusLabel).toBe('החיבור לא הושלם')
    expect(copy?.actionLabel).toBe('לנסות שוב')
  })

  it('shows processing while the existing connect POST is in flight', () => {
    const copy = facebookReturnCopy({
      pendingPages: [{ id: '1' }],
      error: null,
      select: true,
      completing: true,
    })
    expect(copy?.statusLabel).toBe('משלים חיבור...')
  })
})

describe('whatsappReturnCopy', () => {
  it('explains cancel instead of staying silent', () => {
    const copy = whatsappReturnCopy({
      pendingPhones: null,
      error: 'cancelled',
      completing: false,
    })
    expect(copy?.statusLabel).toContain('וואטסאפ')
    expect(copy?.role).toBe('error')
  })
})

describe('calendarReturnCopy', () => {
  it('prefers the server connection over a leftover error param', () => {
    expect(
      calendarReturnCopy({ connected: true, error: 'denied', connecting: false }),
    ).toBeNull()
  })

  it('explains Google cancel', () => {
    const copy = calendarReturnCopy({ connected: false, error: 'denied', connecting: false })
    expect(copy?.statusLabel).toBe('החיבור לא הושלם')
    expect(copy?.actionLabel).toBe('לנסות שוב')
  })
})

describe('auto-complete predicates', () => {
  it('auto-completes only a single pending Facebook page', () => {
    expect(shouldAutoCompleteFacebook([{ id: '1' }], false)).toBe(true)
    expect(shouldAutoCompleteFacebook([{ id: '1' }, { id: '2' }], false)).toBe(false)
    expect(shouldAutoCompleteFacebook([{ id: '1' }], true)).toBe(false)
  })

  it('auto-completes only a single pending WhatsApp phone', () => {
    expect(shouldAutoCompleteWhatsapp([{ id: '1' }], false)).toBe(true)
    expect(shouldAutoCompleteWhatsapp([{ id: '1' }, { id: '2' }], false)).toBe(false)
  })
})
