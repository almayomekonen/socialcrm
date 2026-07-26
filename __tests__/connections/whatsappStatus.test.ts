/**
 * resolveWhatsappStatus — the server-side truth used by settings. Verifies the
 * classification of new / proven / legacy-unverified connections without a DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ inbound: null as unknown }))

vi.mock('@/config/db', () => ({
  db: (_t: string) => ({ where: () => ({ first: async () => h.inbound }) }),
}))
const reg = vi.hoisted(() => ({ subscribed: false, ready: false }))
vi.mock('@/lib/whatsapp/registration', () => ({
  checkAppSubscribed: vi.fn(async () => reg.subscribed),
  checkMessagingReady: vi.fn(async () => reg.ready),
}))

import { resolveWhatsappStatus } from '@/lib/whatsapp/operationalStatus'

const conn = (waba: string | null) => ({ phone_number_id: 'P1', access_token: 't', waba_id: waba })

beforeEach(() => {
  h.inbound = null
  reg.subscribed = false
  reg.ready = false
})

describe('resolveWhatsappStatus', () => {
  it('proven inbound history → operational (agency 103), no Graph call needed', async () => {
    h.inbound = { id: 1 }
    expect(await resolveWhatsappStatus(conn('W1'), 103)).toBe('operational')
  })

  it('legacy row with no WABA id (Oren) → needs_verification, NOT operational', async () => {
    expect(await resolveWhatsappStatus(conn(null), 69)).toBe('needs_verification')
  })

  it('new row: subscribed + ready → operational', async () => {
    reg.subscribed = true
    reg.ready = true
    expect(await resolveWhatsappStatus(conn('W1'), 5)).toBe('operational')
  })

  it('subscribed but phone not ready → not_ready', async () => {
    reg.subscribed = true
    reg.ready = false
    expect(await resolveWhatsappStatus(conn('W1'), 5)).toBe('not_ready')
  })

  it('cannot verify subscription → needs_verification (never falsely operational)', async () => {
    reg.subscribed = false
    reg.ready = true
    expect(await resolveWhatsappStatus(conn('W1'), 5)).toBe('needs_verification')
  })
})
