/**
 * Shared fixtures for the Reminder Engine Phase 5 (delivery) database tests.
 *
 * EVERY value written to platform_whatsapp_send_controls and
 * platform_whatsapp_rate_cards here is SYNTHETIC, for tests only. None of them
 * is an approved limit or a real Meta price; production keeps them NULL.
 */
import { db } from '@/config/db'
import { hashPlatformSender } from '@/lib/whatsapp/platform/keys'
import { seedOwner, type Owner } from './fixtures'

export const T = 'owner_personal_reminders'
const MIN = 60_000
let seq = 0

export const TEST_CONTROLS = {
  remindersEnabled: true,
  trippedAt: null,
  trippedReason: null,
  billingTimezone: 'Asia/Jerusalem',
  billingCurrency: 'USD',
  platformDailyCap: 50,
  recipientDailyCap: 30,
  agencyDailyCap: 40,
  remindersMonthlyBudget: 1000,
  remindersMonthlyBudgetMicros: 1_000_000_000,
  serviceSoftLimit: 900,
  serviceEmergencyLimit: 950,
  pricingMaxAgeDays: 30,
}
export const TEST_PRICE_MICROS = 4_000

/** The setup TRUNCATEs every table between tests, so the seeded row may be gone: upsert it. */
async function upsertControls(values: Record<string, unknown>): Promise<void> {
  await db('platform_whatsapp_send_controls').insert({ id: 1, ...values }).onConflict('id').merge()
}

/** Synthetic controls on, heartbeat fresh, one synthetic Israeli `service` rate, counters empty. */
export async function enableDelivery(over: Record<string, unknown> = {}, nowMs = Date.now()): Promise<void> {
  await upsertControls({ ...TEST_CONTROLS, monitorLastRunAt: new Date(nowMs), ...over })
  await db('owner_reminder_send_capacity').del()
  await db(T).whereNotNull('rateCardId').update({ rateCardId: null })
  await db('platform_whatsapp_rate_cards').del()
  await db('platform_whatsapp_rate_cards').insert({
    market: 'Israel', countryCode: '972', category: 'service', currency: 'USD', unitPriceMicros: TEST_PRICE_MICROS,
    effectiveFrom: '2026-01-01', sourceRef: 'synthetic-test', verifiedAt: new Date(nowMs), verifiedBy: 'test',
  })
}

/** Back to the migration's seed: disabled, every unapproved value NULL. */
export async function resetControls(): Promise<void> {
  await upsertControls({
    remindersEnabled: false, trippedAt: null, trippedReason: null, billingTimezone: null, billingCurrency: null,
    platformDailyCap: 50, recipientDailyCap: 30, agencyDailyCap: null, remindersMonthlyBudget: null,
    remindersMonthlyBudgetMicros: null, serviceSoftLimit: null, serviceEmergencyLimit: null, pricingMaxAgeDays: null, monitorLastRunAt: null,
  })
  await db('owner_reminder_send_capacity').del()
}

export async function phoneOf(o: Owner): Promise<string> {
  return ((await db('owner_whatsapp_recipients').where({ id: o.recipientId }).first('phoneE164')) as { phoneE164: string }).phoneE164
}

/** An inbound message from the owner to the platform number at `atMs`, with its timestamp provenance. */
export async function inboundFrom(o: Owner, atMs: number, source: 'meta' | 'server' | null = 'meta'): Promise<void> {
  const digits = (await phoneOf(o)).replace(/\D/g, '')
  await db('platform_whatsapp_inbound').insert({
    wamid: `wamid.in.${Date.now()}.${++seq}`, kind: 'other', fromHash: hashPlatformSender(digits),
    messageTimestamp: Math.floor(atMs / 1000), timestampSource: source,
  })
}

/** A v5 owner who wrote to the platform number a minute ago. */
export async function readyOwner(name: string): Promise<Owner> {
  const o = await seedOwner(name)
  await db('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ consentTextVersion: 'v5' })
  await inboundFrom(o, Date.now() - MIN)
  return o
}

/** A reminder inserted directly in a lifecycle state. `remindAtMs` defaults to now (due). */
export async function insertReminder(
  o: Owner,
  status: 'scheduled' | 'claimed' | 'dispatching' | 'sent',
  over: Record<string, unknown> & { remindAtMs?: number } = {},
): Promise<{ id: number; claimToken: string }> {
  const { remindAtMs, ...rest } = over
  const remindAt = new Date(remindAtMs ?? Date.now())
  const claimToken = `00000000-0000-4000-8000-${String(++seq + 500_000).padStart(12, '0')}`
  const now = new Date()
  const [r] = await db(T)
    .insert({
      agencyId: o.agencyId, userId: o.userId, recipientId: o.recipientId, text: 'להתקשר לאבי', textLength: 11, remindAt,
      createdAt: new Date(remindAt.getTime() - 24 * 60 * MIN), anchorMessageTs: Math.floor(Date.now() / 1000),
      sourceWamid: `wamid.d.${++seq}`, status, nextAttemptAt: remindAt, createdByActionId: `rem_${900000 + seq}_v1_create`,
      ...(status !== 'scheduled' ? { claimToken, claimedAt: now } : {}),
      ...(status === 'dispatching' || status === 'sent' ? { dispatchedAt: now } : {}),
      ...(status === 'sent' ? { wamid: `wamid.out.${seq}`, sentAt: now, finalizedAt: now } : {}),
      ...rest,
    })
    .returning('id')
  return { id: Number(r.id), claimToken }
}

export async function row(id: number): Promise<Record<string, unknown>> {
  return (await db(T).where({ id }).first()) as Record<string, unknown>
}

/** Every capacity counter, keyed `kind:scopeId`. */
export async function counters(): Promise<Record<string, { reserved: number; micros: number }>> {
  const rows = (await db('owner_reminder_send_capacity').select('scopeKind', 'scopeId', 'reserved', 'reservedMicros')) as Record<string, unknown>[]
  return Object.fromEntries(rows.map((r) => [`${r.scopeKind}:${r.scopeId}`, { reserved: Number(r.reserved), micros: Number(r.reservedMicros) }]))
}

export async function eventsOf(id: number): Promise<{ type: string; reason: string | null }[]> {
  return (await db('owner_personal_reminder_events').where({ reminderId: id }).orderBy('id').select('type', 'reason')) as { type: string; reason: string | null }[]
}
