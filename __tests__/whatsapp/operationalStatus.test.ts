/**
 * resolveWhatsappHealth — settings truth. Inbound for another agency/phone
 * must never paint this connection green.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const q = vi.hoisted(() => ({
  wheres: [] as unknown[],
  joins: [] as unknown[],
  whereNotExists: 0,
  row: null as unknown,
}))

vi.mock('@/config/db', () => {
  const chain: Record<string, unknown> = {}
  chain.join = (...a: unknown[]) => {
    q.joins.push(a)
    return chain
  }
  chain.where = (...a: unknown[]) => {
    q.wheres.push(a)
    return chain
  }
  chain.whereNotExists = () => {
    q.whereNotExists += 1
    return chain
  }
  chain.orderBy = () => chain
  chain.first = async () => q.row
  const db = Object.assign(() => chain, { raw: (sql: string) => sql })
  return { db }
})

import {
  accountRestrictionIsActive,
  queryAccountFailureForPhone,
  queryInboundForPhone,
  resolveWhatsappHealth,
  type WhatsappHealthDeps,
} from '@/lib/whatsapp/operationalStatus'
import type { PhoneStatusProbe, SubscribedAppsProbe } from '@/lib/whatsapp/registration'

const PHONE = '1216762448189306'
const OTHER_PHONE = '999000111'
const conn = (waba: string | null = 'W1') => ({
  phone_number_id: PHONE,
  access_token: 't',
  waba_id: waba,
})

function deps(partial: Partial<WhatsappHealthDeps> = {}): WhatsappHealthDeps {
  return {
    hasInboundForPhone: async () => false,
    hasAccountFailure: async () => false,
    probePhone: async () => ({ ok: true, status: 'CONNECTED' }),
    probeSubscribed: async () => ({ ok: true, subscribed: true }),
    ...partial,
  }
}

beforeEach(() => {
  q.wheres = []
  q.joins = []
  q.whereNotExists = 0
  q.row = null
})

describe('resolveWhatsappHealth', () => {
  it('no connection → disconnected', async () => {
    const health = await resolveWhatsappHealth(null, 23, deps())
    expect(health.primary).toBe('disconnected')
    expect(health.inbound).toBe('not_ready')
    expect(health.outbound).toBe('not_ready')
  })

  it('inbound from another agency must NOT make this agency operational', async () => {
    const health = await resolveWhatsappHealth(
      conn(),
      23,
      deps({
        // Other agency has inbound; this agency's phone-scoped lookup is empty.
        hasInboundForPhone: async (agencyId) => agencyId !== 23,
        probeSubscribed: async () => ({ ok: true, subscribed: false }),
      }),
    )
    expect(health.primary).not.toBe('operational')
  })

  it('inbound from another phone must NOT make this phone operational', async () => {
    const health = await resolveWhatsappHealth(
      conn(),
      23,
      deps({
        hasInboundForPhone: async (_agencyId, phoneNumberId) => phoneNumberId !== PHONE,
        probeSubscribed: async () => ({ ok: true, subscribed: false }),
      }),
    )
    expect(health.primary).not.toBe('operational')
  })

  it('this phone inbound-ready + CONNECTED + no account failure → operational', async () => {
    const health = await resolveWhatsappHealth(
      conn(),
      23,
      deps({
        hasInboundForPhone: async (agencyId, phoneNumberId) => agencyId === 23 && phoneNumberId === PHONE,
      }),
    )
    expect(health).toEqual({
      primary: 'operational',
      inbound: 'ready',
      outbound: 'ready',
    })
  })

  it('account restriction → restricted (inbound may still be ready)', async () => {
    const health = await resolveWhatsappHealth(
      conn(),
      23,
      deps({
        hasInboundForPhone: async () => true,
        hasAccountFailure: async () => true,
      }),
    )
    expect(health.primary).toBe('restricted')
    expect(health.inbound).toBe('ready')
    expect(health.outbound).toBe('restricted')
  })

  it('restricted must never be operational', async () => {
    const health = await resolveWhatsappHealth(
      conn(),
      23,
      deps({
        hasInboundForPhone: async () => true,
        hasAccountFailure: async () => true,
        probeSubscribed: async () => ({ ok: true, subscribed: true }),
      }),
    )
    expect(health.primary).toBe('restricted')
    expect(health.primary).not.toBe('operational')
  })

  it('token 401 / Graph 190 → token', async () => {
    const unauthorized: PhoneStatusProbe = { ok: false, kind: 'token' }
    const health401 = await resolveWhatsappHealth(conn(), 23, deps({ probePhone: async () => unauthorized }))
    expect(health401.primary).toBe('token')

    const graph190: SubscribedAppsProbe = { ok: false, kind: 'token' }
    const health190 = await resolveWhatsappHealth(
      conn(),
      23,
      deps({
        probePhone: async () => ({ ok: true, status: 'CONNECTED' }),
        probeSubscribed: async () => graph190,
      }),
    )
    expect(health190.primary).toBe('token')
  })

  it('webhook not subscribed + no inbound → webhook', async () => {
    const health = await resolveWhatsappHealth(
      conn(),
      23,
      deps({
        hasInboundForPhone: async () => false,
        probeSubscribed: async () => ({ ok: true, subscribed: false }),
      }),
    )
    expect(health.primary).toBe('webhook')
    expect(health.inbound).toBe('not_ready')
  })

  it('phone status != CONNECTED → registration_pending', async () => {
    const health = await resolveWhatsappHealth(
      conn(),
      23,
      deps({
        probePhone: async () => ({ ok: true, status: 'PENDING' }),
      }),
    )
    expect(health.primary).toBe('registration_pending')
    expect(health.outbound).toBe('not_ready')
  })
})

describe('phone-scoped inbox lookups', () => {
  it('inbound query is scoped to this agency and this phone', async () => {
    await queryInboundForPhone(23, PHONE)
    expect(q.joins.length).toBeGreaterThan(0)
    expect(q.wheres).toEqual(
      expect.arrayContaining([
        ['m.agencyId', 23],
        ['m.direction', 'inbound'],
        ['c.businessPhoneNumberId', PHONE],
      ]),
    )
    expect(q.wheres.flat()).not.toContain(OTHER_PHONE)
  })

  it('account-failure query is scoped to this agency and this phone', async () => {
    await queryAccountFailureForPhone(23, PHONE)
    expect(q.wheres).toEqual(
      expect.arrayContaining([
        ['m.agencyId', 23],
        ['m.direction', 'outbound'],
        ['m.errorReason', 'account'],
        ['c.businessPhoneNumberId', PHONE],
      ]),
    )
    expect(q.whereNotExists).toBeGreaterThan(0)
  })
})

describe('accountRestrictionIsActive — recovery', () => {
  it('no account failure → not active', () => {
    expect(accountRestrictionIsActive({ latestAccountFailureAt: null, latestSuccessfulOutboundAt: null })).toBe(false)
  })

  it('account failure with no later success → active', () => {
    expect(
      accountRestrictionIsActive({
        latestAccountFailureAt: '2026-08-15T10:00:00.000Z',
        latestSuccessfulOutboundAt: null,
      }),
    ).toBe(true)
  })

  it('later successful outbound clears the restriction', () => {
    expect(
      accountRestrictionIsActive({
        latestAccountFailureAt: '2026-08-15T10:00:00.000Z',
        latestSuccessfulOutboundAt: '2026-08-15T11:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('a later success on the same timestamp does not accidentally clear', () => {
    const at = '2026-08-15T10:00:00.000Z'
    expect(accountRestrictionIsActive({ latestAccountFailureAt: at, latestSuccessfulOutboundAt: at })).toBe(true)
  })

  it('an older success does not clear a newer account failure', () => {
    expect(
      accountRestrictionIsActive({
        latestAccountFailureAt: '2026-08-15T12:00:00.000Z',
        latestSuccessfulOutboundAt: '2026-08-15T10:00:00.000Z',
      }),
    ).toBe(true)
  })
})
