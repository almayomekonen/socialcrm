import { describe, expect, it } from 'vitest'
import {
  createEmbeddedSignupGate,
  hasUsableWaba,
  isFacebookOrigin,
  parseEmbeddedSignupMessage,
} from '@/lib/facebook/embeddedSignupSession'

const FINISH = {
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH',
  data: { waba_id: 'WABA_1', phone_number_id: 'PHONE_1' },
}

const FINISH_COEXISTENCE = {
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  data: { waba_id: 'WABA_2', phone_number_id: 'PHONE_2' },
}

function sessionFrom(event: object, origin = 'https://www.facebook.com') {
  return parseEmbeddedSignupMessage(origin, event)
}

describe('isFacebookOrigin', () => {
  it('accepts known Facebook hosts over HTTPS', () => {
    expect(isFacebookOrigin('https://www.facebook.com')).toBe(true)
    expect(isFacebookOrigin('https://business.facebook.com')).toBe(true)
    expect(isFacebookOrigin('https://web.facebook.com')).toBe(true)
    expect(isFacebookOrigin('https://foo.facebook.com')).toBe(true)
  })

  it('rejects lookalike hosts and non-HTTPS', () => {
    expect(isFacebookOrigin('https://evilfacebook.com')).toBe(false)
    expect(isFacebookOrigin('http://www.facebook.com')).toBe(false)
    expect(isFacebookOrigin('not-a-url')).toBe(false)
  })
})

describe('parseEmbeddedSignupMessage', () => {
  it('reads FINISH session-info, including stringified payloads', () => {
    expect(sessionFrom(FINISH)).toEqual({
      waba_id: 'WABA_1',
      phone_number_id: 'PHONE_1',
      onboardingType: 'cloud_api',
    })
    expect(sessionFrom(JSON.stringify(FINISH) as unknown as object)).toEqual({
      waba_id: 'WABA_1',
      phone_number_id: 'PHONE_1',
      onboardingType: 'cloud_api',
    })
  })

  it('reads the coexistence FINISH event', () => {
    expect(sessionFrom(FINISH_COEXISTENCE)).toEqual({
      waba_id: 'WABA_2',
      phone_number_id: 'PHONE_2',
      onboardingType: 'coexistence',
    })
  })

  it('ignores non-Facebook origins, other event types, and cancel/error', () => {
    expect(parseEmbeddedSignupMessage('https://evilfacebook.com', FINISH)).toBeNull()
    expect(sessionFrom({ type: 'OTHER', event: 'FINISH', data: FINISH.data })).toBeNull()
    expect(sessionFrom({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: FINISH.data })).toBeNull()
    expect(sessionFrom({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR' })).toBeNull()
  })

  it('keeps a FINISH without waba_id — the gate must not treat it as ready', () => {
    const parsed = sessionFrom({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: {} })
    expect(parsed).toEqual({ waba_id: undefined, phone_number_id: undefined, onboardingType: 'cloud_api' })
    expect(hasUsableWaba(parsed)).toBe(false)
  })
})

describe('createEmbeddedSignupGate — event order', () => {
  it('A: session-info then FINISH/code → ready', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptSession(sessionFrom(FINISH)!)
    gate.acceptCode('oauth-code')
    await expect(gate.outcome).resolves.toEqual({
      kind: 'ready',
      code: 'oauth-code',
      session: {
        waba_id: 'WABA_1',
        phone_number_id: 'PHONE_1',
        onboardingType: 'cloud_api',
      },
    })
  })

  it('B: code then session-info → ready (the production race)', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptCode('oauth-code')
    gate.acceptSession(sessionFrom(FINISH)!)
    await expect(gate.outcome).resolves.toMatchObject({
      kind: 'ready',
      code: 'oauth-code',
      session: { waba_id: 'WABA_1' },
    })
  })

  it('duplicate FINISH/session-info: last usable session wins; single settle', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptSession(sessionFrom(FINISH)!)
    gate.acceptSession(sessionFrom(FINISH_COEXISTENCE)!)
    gate.acceptCode('oauth-code')
    const first = await gate.outcome
    gate.acceptSession(sessionFrom(FINISH)!)
    gate.acceptCode('second-code')
    const second = await gate.outcome
    expect(first).toMatchObject({
      kind: 'ready',
      code: 'oauth-code',
      session: { waba_id: 'WABA_2', onboardingType: 'coexistence' },
    })
    expect(second).toBe(first)
  })

  it('duplicate code after ready is ignored', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptSession(sessionFrom(FINISH)!)
    gate.acceptCode('first')
    gate.acceptCode('second')
    await expect(gate.outcome).resolves.toMatchObject({ kind: 'ready', code: 'first' })
  })

  it('coexistence path: either event order yields onboardingType coexistence', async () => {
    const a = createEmbeddedSignupGate()
    a.acceptSession(sessionFrom(FINISH_COEXISTENCE)!)
    a.acceptCode('c1')
    await expect(a.outcome).resolves.toMatchObject({
      kind: 'ready',
      session: { onboardingType: 'coexistence', waba_id: 'WABA_2' },
    })

    const b = createEmbeddedSignupGate()
    b.acceptCode('c2')
    b.acceptSession(sessionFrom(FINISH_COEXISTENCE)!)
    await expect(b.outcome).resolves.toMatchObject({
      kind: 'ready',
      session: { onboardingType: 'coexistence' },
    })
  })
})

describe('createEmbeddedSignupGate — failures', () => {
  it('missing/invalid WABA: FINISH without waba_id plus code does not become ready', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptSession(sessionFrom({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: {} })!)
    gate.acceptCode('oauth-code')
    gate.expire()
    await expect(gate.outcome).resolves.toEqual({ kind: 'error', error: 'missing_details' })
  })

  it('code without session-info, then expire → missing_details (not cancelled)', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptCode('oauth-code')
    gate.expire()
    await expect(gate.outcome).resolves.toEqual({ kind: 'error', error: 'missing_details' })
  })

  it('expire before any code is a no-op so a long popup is not failed', async () => {
    const gate = createEmbeddedSignupGate()
    gate.expire()
    gate.acceptSession(sessionFrom(FINISH)!)
    gate.acceptCode('oauth-code')
    await expect(gate.outcome).resolves.toMatchObject({ kind: 'ready', code: 'oauth-code' })
  })

  it('cancel / empty code is silent cancelled', async () => {
    const cancelled = createEmbeddedSignupGate()
    cancelled.cancel()
    await expect(cancelled.outcome).resolves.toEqual({ kind: 'cancelled' })

    const empty = createEmbeddedSignupGate()
    empty.acceptSession(sessionFrom(FINISH)!)
    empty.acceptCode('')
    await expect(empty.outcome).resolves.toEqual({ kind: 'cancelled' })
  })
})
