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
    rotateToken: async () => 1,
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

  it('blocks the operator-verified platform number (0549221572) by phone id and WABA', () => {
    expect(BLOCKED_PHONE_NUMBER_ID).toBe('1216762448189306')
    expect(BLOCKED_WABA_ID).toBe('2060714354527399')
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
      deps({
        inserted,
        findByPhone: async () => ({
          agency_id: 64,
          waba_id: MANUAL_ATTACH_WABA_ID,
          onboarding_type: 'cloud_api',
        }),
      }),
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

/**
 * Token rotation on an already-claimed phone.
 *
 * Production 2026-09-01: row 25's System User token expired (Graph 401 /
 * OAuthException 190). Inbound kept working — webhooks need no token — but every
 * outbound Graph call failed. The attach path was INSERT-only and refused a
 * claimed phone outright, so the only way to install a new credential was to
 * delete the row and re-attach: i.e. to disconnect the very connection being
 * repaired, on a number whose WhatsApp Business App history must be preserved.
 *
 * Rotation replaces `access_token` in place, and only when the row is
 * unmistakably the same connection.
 */
describe('attachExistingWabaForUser · token rotation', () => {
  const CLAIMED = {
    agency_id: MANUAL_ATTACH_AGENCY_ID,
    waba_id: MANUAL_ATTACH_WABA_ID,
    onboarding_type: 'cloud_api',
  }

  type RotateCall = { phoneNumberId: string; agencyId: number; wabaId: string; sealed: string }

  function rotatingDeps(
    claimed: { agency_id: number; waba_id: string; onboarding_type: string } | null,
    calls: RotateCall[],
    inserted: Record<string, unknown>[] = [],
    affected = 1,
  ) {
    return deps({
      inserted,
      findByPhone: async () => claimed,
      rotateToken: async (input) => {
        calls.push(input)
        return affected
      },
    })
  }

  it('a. rotates when agency, WABA and onboarding_type all match', async () => {
    const calls: RotateCall[] = []
    const inserted: Record<string, unknown>[] = []
    const r = await attachExistingWabaForUser(ADMIN, VALID_INPUT, rotatingDeps(CLAIMED, calls, inserted))

    expect(r).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(inserted).toHaveLength(0) // never insert; never delete/recreate
  })

  it('b. refuses a phone claimed by a DIFFERENT agency', async () => {
    const calls: RotateCall[] = []
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      rotatingDeps({ ...CLAIMED, agency_id: 64 }, calls),
    )
    expect(r).toEqual({ ok: false, reason: 'phone_claimed' })
    expect(calls).toHaveLength(0) // no write attempted at all
  })

  it('c. refuses when the stored WABA differs', async () => {
    const calls: RotateCall[] = []
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      rotatingDeps({ ...CLAIMED, waba_id: '999999999999999' }, calls),
    )
    expect(r).toEqual({ ok: false, reason: 'phone_claimed' })
    expect(calls).toHaveLength(0)
  })

  it('d. refuses a row that is not cloud_api', async () => {
    // A coexistence row is a different lifecycle and is not this path's to touch.
    const calls: RotateCall[] = []
    const r = await attachExistingWabaForUser(
      ADMIN,
      VALID_INPUT,
      rotatingDeps({ ...CLAIMED, onboarding_type: 'coexistence' }, calls),
    )
    expect(r).toEqual({ ok: false, reason: 'phone_claimed' })
    expect(calls).toHaveLength(0)
  })

  it('e. touches ONLY access_token — identity columns are guards, never writes', async () => {
    const calls: RotateCall[] = []
    await attachExistingWabaForUser(ADMIN, VALID_INPUT, rotatingDeps(CLAIMED, calls))

    // The only value carried to the writer is the sealed token. Every other
    // field is an identity guard the UPDATE matches on, so id / user_id /
    // created_at / onboarding_type / health_status cannot be reached from here.
    expect(Object.keys(calls[0]).sort()).toEqual(['agencyId', 'phoneNumberId', 'sealed', 'wabaId'])
    expect(calls[0].phoneNumberId).toBe(MANUAL_ATTACH_PHONE_NUMBER_ID)
    expect(calls[0].wabaId).toBe(MANUAL_ATTACH_WABA_ID)
    expect(calls[0].agencyId).toBe(MANUAL_ATTACH_AGENCY_ID)
  })

  it('f. stores the token SEALED, never the raw value', async () => {
    const calls: RotateCall[] = []
    await attachExistingWabaForUser(ADMIN, VALID_INPUT, rotatingDeps(CLAIMED, calls))

    const { sealed } = calls[0]
    expect(sealed.startsWith(WHATSAPP_TOKEN_SEAL_PREFIX)).toBe(true)
    expect(sealed).not.toBe(TOKEN)
    expect(sealed).not.toContain(TOKEN)
    expect(resolveWhatsappAccessToken(sealed)).toBe(TOKEN)
  })

  it('validates the new token against Graph BEFORE writing anything', async () => {
    // A dead credential must never replace a live one.
    const calls: RotateCall[] = []
    const r = await attachExistingWabaForUser(ADMIN, VALID_INPUT, {
      ...rotatingDeps(CLAIMED, calls),
      fetchImpl: graphOkFetch({ tokenBad: true }),
    })
    expect(r).toEqual({ ok: false, reason: 'graph_token' })
    expect(calls).toHaveLength(0)
  })

  it('refuses a token that cannot see the app subscription', async () => {
    const calls: RotateCall[] = []
    const r = await attachExistingWabaForUser(ADMIN, VALID_INPUT, {
      ...rotatingDeps(CLAIMED, calls),
      fetchImpl: graphOkFetch({ subscribed: false }),
    })
    expect(r).toEqual({ ok: false, reason: 'not_subscribed' })
    expect(calls).toHaveLength(0)
  })

  it('reports db_error when the guarded UPDATE matches no row', async () => {
    // The guards live in the WHERE clause, so a row that changed underneath us
    // updates zero rows rather than being silently overwritten.
    const calls: RotateCall[] = []
    const r = await attachExistingWabaForUser(ADMIN, VALID_INPUT, rotatingDeps(CLAIMED, calls, [], 0))
    expect(r).toEqual({ ok: false, reason: 'db_error' })
  })

  it('still refuses a non-admin and a foreign agency before reaching rotation', async () => {
    const calls: RotateCall[] = []
    expect(
      await attachExistingWabaForUser({ ...ADMIN, role: 'AGNT' }, VALID_INPUT, rotatingDeps(CLAIMED, calls)),
    ).toEqual({ ok: false, reason: 'forbidden' })
    expect(
      await attachExistingWabaForUser({ ...ADMIN, agencyId: 23 }, VALID_INPUT, rotatingDeps(CLAIMED, calls)),
    ).toEqual({ ok: false, reason: 'agency_not_allowed' })
    expect(calls).toHaveLength(0)
  })
})
