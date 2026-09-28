/**
 * Did the SERVER already record an outcome for a WhatsApp connect attempt?
 *
 * The browser reports `abandoned` for an attempt its page did not survive. If
 * the page was reloaded while `/api/whatsapp/embedded-signup` was finishing, the
 * server has already written the attempt's outcome — success
 * (`whatsapp_connected_operational`) or a server-stage failure — and an
 * `abandoned` beside it would contradict it. This is the read that prevents it.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { hasServerConnectOutcomeSince } from '@/lib/analytics/connectOutcome'
import { cleanupBilling, seedAgency } from '../payments/helpers/billingFixtures'

afterEach(async () => {
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

async function event(agencyId: number, name: string, props: Record<string, unknown>, createdAt: Date) {
  await db('analytics_events').insert({ agencyId, event: name, props, createdAt })
}

describe('hasServerConnectOutcomeSince', () => {
  it('sees a success recorded after the attempt started', async () => {
    const agencyId = await seedAgency()
    await event(agencyId, 'whatsapp_connected_operational', {}, minutesAgo(1))
    expect(await hasServerConnectOutcomeSince(agencyId, minutesAgo(2))).toBe(true)
  })

  it('sees a server-stage failure (the connection was saved but is not ready)', async () => {
    const agencyId = await seedAgency()
    await event(agencyId, 'whatsapp_connect_failed', { reason: 'PHONE_NOT_READY', stage: 'readiness' }, minutesAgo(1))
    expect(await hasServerConnectOutcomeSince(agencyId, minutesAgo(2))).toBe(true)
  })

  it('ignores outcomes from before this attempt', async () => {
    const agencyId = await seedAgency()
    await event(agencyId, 'whatsapp_connected_operational', {}, minutesAgo(30))
    expect(await hasServerConnectOutcomeSince(agencyId, minutesAgo(2))).toBe(false)
  })

  it('ignores client-reported failures and the start event', async () => {
    const agencyId = await seedAgency()
    await event(agencyId, 'whatsapp_connect_failed', { reason: 'cancelled', stage: 'client' }, minutesAgo(1))
    await event(agencyId, 'whatsapp_connect_started', {}, minutesAgo(1))
    expect(await hasServerConnectOutcomeSince(agencyId, minutesAgo(2))).toBe(false)
  })

  it('never reads another agency’s events', async () => {
    const mine = await seedAgency()
    const other = await seedAgency()
    await event(other, 'whatsapp_connected_operational', {}, minutesAgo(1))
    expect(await hasServerConnectOutcomeSince(mine, minutesAgo(2))).toBe(false)
  })
})
