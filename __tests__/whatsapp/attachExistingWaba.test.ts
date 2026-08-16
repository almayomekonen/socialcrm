import { describe, it, expect, beforeEach } from 'vitest'
import {
  attachExistingWabaForUser,
  verifyManualAttachGraph,
  isManualAttachEnabled,
  MANUAL_ATTACH_AGENCY_ID,
  MANUAL_ATTACH_WABA_ID,
  MANUAL_ATTACH_PHONE_NUMBER_ID,
  BLOCKED_PHONE_NUMBER_ID,
  BLOCKED_WABA_ID,
  type AttachExistingWabaDeps,
} from '@/lib/whatsapp/attachExistingWaba'
import {
  sealWhatsappAccessToken,
  resolveWhatsappAccessToken,
  WHATSAPP_TOKEN_SEAL_PREFIX,
} from '@/lib/whatsapp/connectionToken'

const ADMIN = { id: 332, agencyId: MANUAL_ATTACH_AGENCY_ID, role: 'ADMIN' }
const TOKEN = 'test-system-user-token-not-real'

function json(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as Response
}

function graphOkFetch(overrides?: {
  tokenBad?: boolean
  wabaMissing?: boolean
  phoneMissing?: boolean
  display?: string
  status?: string
  platform?: string
  phoneOnWaba?: boolean
  subscribed?: boolean
  subscribedShape?: 'nested' | 'flat'
}): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url)
    expect(u).not.toContain('access_token=')
    expect(u).not.toContain('/register')
    if (overrides?.tokenBad) return json(401, { error: { code: 190 } })
    if (u.includes(`${MANUAL_ATTACH_WABA_ID}?fields=id,name`)) {
      if (overrides?.wabaMissing) return json(400, { error: { message: 'no' } })
      return json(200, { id: MANUAL_ATTACH_WABA_ID, name: 'אלמיהו מקונן' })
    }
    if (u.includes(`${MANUAL_ATTACH_PHONE_NUMBER_ID}?fields=id,display_phone_number`)) {
      if (overrides?.phoneMissing) return json(400, { error: { message: 'no' } })
      return json(200, {
        id: MANUAL_ATTACH_PHONE_NUMBER_ID,
        display_phone_number: overrides?.display ?? '+972 53-531-7356',
        status: overrides?.status ?? 'CONNECTED',
        platform_type: overrides?.platform ?? 'CLOUD_API',
      })
    }
    if (u.includes(`${MANUAL_ATTACH_WABA_ID}/phone_numbers`)) {
      const id = overrides?.phoneOnWaba === false ? '999' : MANUAL_ATTACH_PHONE_NUMBER_ID
      return json(200, { data: [{ id }] })
    }
    if (u.includes(`${MANUAL_ATTACH_WABA_ID}/subscribed_apps`)) {
      if (overrides?.subscribed === false) return json(200, { data: [] })
      if (overrides?.subscribedShape === 'flat') {
        return json(200, { data: [{ id: '962521689620138' }] })
      }
      return json(200, { data: [{ whatsapp_business_api_data: { id: '962521689620138' } }] })
    }
    return json(500, { error: { message: 'unexpected graph url' } })
  }) as typeof fetch
}

function deps(overrides: Partial<AttachExistingWabaDeps> & { inserted?: Record<string, unknown>[] } = {}): AttachExistingWabaDeps {
  const inserted = overrides.inserted ?? []
  return {
    fetchImpl: graphOkFetch(),
    isEnabled: () => true,
    findByPhone: async () => null,
    findByAgency: async () => null,
    insertConnection: async (row) => {
      inserted.push(row)
    },
    trackAttach: async () => {},
    ...overrides,
  }
}

const VALID_INPUT = {
  wabaId: MANUAL_ATTACH_WABA_ID,
  phoneNumberId: MANUAL_ATTACH_PHONE_NUMBER_ID,
  accessToken: TOKEN,
}

describe('WhatsApp connection token seal', () => {
  it('round-trips encryption and keeps plaintext ES tokens compatible', () => {
    const sealed = sealWhatsappAccessToken(TOKEN)
    expect(sealed.startsWith(WHATSAPP_TOKEN_SEAL_PREFIX)).toBe(true)
    expect(sealed).not.toBe(TOKEN)
    expect(sealed).not.toContain(TOKEN)
    expect(resolveWhatsappAccessToken(sealed)).toBe(TOKEN)
    expect(resolveWhatsappAccessToken('plaintext-es-token')).toBe('plaintext-es-token')
    expect(resolveWhatsappAccessToken('')).toBe('')
    expect(resolveWhatsappAccessToken(null)).toBe('')
  })
})

describe('isManualAttachEnabled', () => {
  it('is off unless WA_MANUAL_ATTACH_ENABLED=1', () => {
    expect(isManualAttachEnabled(undefined)).toBe(false)
    expect(isManualAttachEnabled('0')).toBe(false)
    expect(isManualAttachEnabled('1')).toBe(true)
  })
})

describe('attachExistingWabaForUser', () => {
  let inserted: Record<string, unknown>[]

  beforeEach(() => {
    inserted = []
  })

  it('rejects when attach is disabled', async () => {
    const r = await attachExistingWabaForUser(ADMIN, VALID_INPUT, deps({ inserted, isEnabled: () => false }))
    expect(r).toEqual({ ok: false, reason: 'attach_disabled' })
    expect(inserted).toHaveLength(0)
  })

  it('rejects missing user', async () => {
    const r = await attachExistingWabaForUser(null, VALID_INPUT, deps({ inserted }))
    expect(r).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it('non-admin rejected', async () => {
    const r = await attachExistingWabaForUser({ ...ADMIN, role: 'AGNT' }, VALID_INPUT, deps({ inserted }))
    expect(r).toEqual({ ok: false, reason: 'forbidden' })
    expect(inserted).toHaveLength(0)
  })

  it('GM is rejected for this temporary attach', async () => {
    const r = await attachExistingWabaForUser({ ...ADMIN, role: 'GM' }, VALID_INPUT, deps({ inserted }))
    expect(r).toEqual({ ok: false, reason: 'forbidden' })
    expect(inserted).toHaveLength(0)
  })

  it('agency other than 103 rejected', async () => {
    const r = await attachExistingWabaForUser({ ...ADMIN, agencyId: 23 }, VALID_INPUT, deps({ inserted }))
    expect(r).toEqual({ ok: false, reason: 'agency_not_allowed' })
    expect(inserted).toHaveLength(0)
  })

  it('wrong WABA rejected', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      { ...VALID_INPUT, wabaId: '111' },
      deps({ inserted }),
    )
    expect(r).toEqual({ ok: false, reason: 'waba_mismatch' })
  })

  it('wrong phone rejected', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      { ...VALID_INPUT, phoneNumberId: '000' },
      deps({ inserted }),
    )
    expect(r).toEqual({ ok: false, reason: 'phone_mismatch' })
  })

  it('0549221572 phone id is hard-blocked', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      { ...VALID_INPUT, phoneNumberId: BLOCKED_PHONE_NUMBER_ID },
      deps({ inserted }),
    )
    expect(r).toEqual({ ok: false, reason: 'blocked_phone' })
  })

  it('0549221572 WABA is hard-blocked', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      { ...VALID_INPUT, wabaId: BLOCKED_WABA_ID },
      deps({ inserted }),
    )
    expect(r).toEqual({ ok: false, reason: 'blocked_waba' })
  })

  it('phone from another agency rejected', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      deps({ inserted, findByPhone: async () => ({ agency_id: 64 }) }),
    )
    expect(r).toEqual({ ok: false, reason: 'phone_claimed' })
    expect(inserted).toHaveLength(0)
  })

  it('does not overwrite an existing agency 103 connection', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      deps({ inserted, findByAgency: async () => ({ id: 9 }) }),
    )
    expect(r).toEqual({ ok: false, reason: 'already_connected' })
    expect(inserted).toHaveLength(0)
  })

  it('bad Graph token rejected', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      deps({ inserted, fetchImpl: graphOkFetch({ tokenBad: true }) }),
    )
    expect(r).toEqual({ ok: false, reason: 'graph_token' })
    expect(inserted).toHaveLength(0)
  })

  it('non-CLOUD_API phone rejected', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      deps({ inserted, fetchImpl: graphOkFetch({ platform: 'NOT_CLOUD' }) }),
    )
    expect(r).toEqual({ ok: false, reason: 'not_cloud_api' })
  })

  it('unsubscribed WABA rejected', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      deps({ inserted, fetchImpl: graphOkFetch({ subscribed: false }) }),
    )
    expect(r).toEqual({ ok: false, reason: 'not_subscribed' })
  })

  it('phone not on WABA rejected', async () => {
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      deps({ inserted, fetchImpl: graphOkFetch({ phoneOnWaba: false }) }),
    )
    expect(r).toEqual({ ok: false, reason: 'phone_not_on_waba' })
  })

  it('successful insert seals the token and never stores plaintext', async () => {
    const r = await attachExistingWabaForUser(ADMIN, VALID_INPUT, deps({ inserted }))
    expect(r).toEqual({ ok: true })
    expect(inserted).toHaveLength(1)
    const row = inserted[0] as {
      agency_id: number
      user_id: number
      phone_number_id: string
      waba_id: string
      onboarding_type: string
      access_token: string
    }
    expect(row.agency_id).toBe(103)
    expect(row.user_id).toBe(332)
    expect(row.phone_number_id).toBe(MANUAL_ATTACH_PHONE_NUMBER_ID)
    expect(row.waba_id).toBe(MANUAL_ATTACH_WABA_ID)
    expect(row.onboarding_type).toBe('cloud_api')
    expect(row.access_token).not.toBe(TOKEN)
    expect(row.access_token.startsWith(WHATSAPP_TOKEN_SEAL_PREFIX)).toBe(true)
    expect(resolveWhatsappAccessToken(row.access_token)).toBe(TOKEN)
  })
})

describe('verifyManualAttachGraph', () => {
  it('accepts nested subscribed_apps app id', async () => {
    const r = await verifyManualAttachGraph(VALID_INPUT, graphOkFetch())
    expect(r).toEqual({ ok: true })
  })

  it('accepts flat subscribed_apps app id', async () => {
    const r = await verifyManualAttachGraph(VALID_INPUT, graphOkFetch({ subscribedShape: 'flat' }))
    expect(r).toEqual({ ok: true })
  })

  it('accepts local Israeli display 0535317356', async () => {
    const r = await verifyManualAttachGraph(VALID_INPUT, graphOkFetch({ display: '0535317356' }))
    expect(r).toEqual({ ok: true })
  })

  it('rejects a different display number', async () => {
    const r = await verifyManualAttachGraph(VALID_INPUT, graphOkFetch({ display: '0549221572' }))
    expect(r).toEqual({ ok: false, reason: 'blocked_phone' })
  })
})
