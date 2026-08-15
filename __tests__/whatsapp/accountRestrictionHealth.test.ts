/**
 * Immediate account-restriction → health. Composer 131031 must invalidate
 * operational for THIS agency+phone before any webhook arrives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendWhatsappText = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const resolveWhatsappOutboundTarget = vi.hoisted(() => vi.fn())
const requireProductAccess = vi.hoisted(() => vi.fn())

type EventKind = 'account' | 'success' | 'other_fail' | 'inbound'
type Event = { agencyId: number; phone: string; kind: EventKind; at: number }

const store = vi.hoisted(() => {
  const events: Event[] = []
  let clock = 0
  return {
    events,
    reset() {
      events.length = 0
      clock = 0
    },
    push(agencyId: number, phone: string, kind: EventKind) {
      events.push({ agencyId, phone, kind, at: ++clock })
    },
  }
})

vi.mock('@/lib/requireUser', () => ({ requireProductAccess }))
vi.mock('@/lib/whatsapp/sendMessage', () => ({ sendWhatsappText }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp }))
vi.mock('@/lib/inbox/recordAccountRestriction', () => ({
  recordAccountRestriction: vi.fn(async (input: { agencyId: number; businessPhoneNumberId: string }) => {
    store.push(input.agencyId, input.businessPhoneNumberId, 'account')
  }),
}))
vi.mock('@/lib/inbox/whatsappOutboundTarget', () => ({ resolveWhatsappOutboundTarget }))

import { sendWhatsappReply } from '@/actions/whatsapp/sendWhatsappReply'
import { recordAccountRestriction } from '@/lib/inbox/recordAccountRestriction'
import {
  accountRestrictionIsActive,
  resolveWhatsappHealth,
  type WhatsappHealthDeps,
} from '@/lib/whatsapp/operationalStatus'

const PHONE_A = '1216762448189306'
const PHONE_B = '999000111'
const AGENCY = 23
const OTHER_AGENCY = 99

const conn = (phone: string) => ({
  phone_number_id: phone,
  access_token: 't',
  waba_id: 'W1',
})

function latestAt(agencyId: number, phone: string, kind: EventKind): number | null {
  const hits = store.events.filter((e) => e.agencyId === agencyId && e.phone === phone && e.kind === kind)
  return hits.length ? hits[hits.length - 1].at : null
}

function toDate(n: number | null): Date | null {
  return n == null ? null : new Date(n)
}

const hasAccountFailure: WhatsappHealthDeps['hasAccountFailure'] = async (agencyId, phone) =>
  accountRestrictionIsActive({
    latestAccountFailureAt: toDate(latestAt(agencyId, phone, 'account')),
    latestSuccessfulOutboundAt: toDate(latestAt(agencyId, phone, 'success')),
  })

function healthDeps(): WhatsappHealthDeps {
  return {
    hasInboundForPhone: async () => true,
    hasAccountFailure,
    probePhone: async () => ({ ok: true, status: 'CONNECTED' }),
    probeSubscribed: async () => ({ ok: true, subscribed: true }),
  }
}

beforeEach(() => {
  store.reset()
  requireProductAccess.mockResolvedValue({ id: 1, agencyId: AGENCY })
  resolveWhatsappOutboundTarget.mockResolvedValue({
    ok: true,
    target: {
      leadId: 9,
      leadName: null,
      businessPhoneNumberId: PHONE_A,
      accessToken: 't',
      customerWaId: '972500000000',
      customerName: null,
    },
  })
  persistOutboundWhatsapp.mockResolvedValue(undefined)
  sendWhatsappText.mockReset()
})

describe('immediate account restriction invalidates health', () => {
  it('A: phone is operational before the send', async () => {
    const health = await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())
    expect(health.primary).toBe('operational')
  })

  it('B+C: send 131031 → health immediately restricted', async () => {
    sendWhatsappText.mockResolvedValue({
      ok: false,
      error: 'Account restricted',
      code: '131031',
      httpStatus: 400,
    })

    expect((await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())).primary).toBe('operational')

    const res = await sendWhatsappReply(9, 'שלום')
    expect(res).toEqual({ ok: false, reason: 'send-failed', category: 'account' })
    expect(recordAccountRestriction).toHaveBeenCalled()

    const health = await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())
    expect(health.primary).toBe('restricted')
    expect(health.outbound).toBe('restricted')
  })

  it('D: another agency remains operational', async () => {
    store.push(AGENCY, PHONE_A, 'account')
    const other = await resolveWhatsappHealth(conn(PHONE_A), OTHER_AGENCY, healthDeps())
    expect(other.primary).toBe('operational')
    const mine = await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())
    expect(mine.primary).toBe('restricted')
  })

  it('E: another WhatsApp phone in the same agency remains unaffected', async () => {
    store.push(AGENCY, PHONE_A, 'account')
    const otherPhone = await resolveWhatsappHealth(conn(PHONE_B), AGENCY, healthDeps())
    expect(otherPhone.primary).toBe('operational')
    const restrictedPhone = await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())
    expect(restrictedPhone.primary).toBe('restricted')
  })

  it('F: webhook-based restriction (account row, no composer persist) still restricts', async () => {
    // Same signal ingestWhatsappStatuses writes: errorReason=account on this phone.
    store.push(AGENCY, PHONE_A, 'account')
    const health = await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())
    expect(health.primary).toBe('restricted')
  })

  it('G: later success clears; later generic failure / inbound do not', async () => {
    store.push(AGENCY, PHONE_A, 'account')
    expect((await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())).primary).toBe('restricted')

    store.push(AGENCY, PHONE_A, 'other_fail')
    store.push(AGENCY, PHONE_A, 'inbound')
    expect((await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())).primary).toBe('restricted')

    store.push(AGENCY, PHONE_A, 'success')
    expect((await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())).primary).toBe('operational')
  })

  it('transient/generic send failure does NOT mark the account restricted', async () => {
    sendWhatsappText.mockResolvedValue({
      ok: false,
      error: 'try again',
      code: '131047',
      httpStatus: 400,
    })
    const res = await sendWhatsappReply(9, 'שלום')
    expect(res.ok).toBe(false)
    if (res.ok === false) expect(res.category).toBe('window_expired')
    expect((await resolveWhatsappHealth(conn(PHONE_A), AGENCY, healthDeps())).primary).toBe('operational')
  })
})
