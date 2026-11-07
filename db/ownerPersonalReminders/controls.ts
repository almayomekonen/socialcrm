import type { Knex } from 'knex'
import { db } from '@/config/db'
import { ACCOUNT_PAUSE_MS } from '@/lib/ownerWhatsappReminders/constants'

/**
 * platform_whatsapp_send_controls (one row, id = 1) and the account pause shared
 * by both owner-reminder systems (approved decision 7).
 */

export type SendControls = {
  remindersEnabled: boolean
  trippedAt: Date | null
  trippedReason: string | null
  billingTimezone: string | null
  billingCurrency: string | null
  platformDailyCap: number
  recipientDailyCap: number
  agencyDailyCap: number | null
  remindersMonthlyBudget: number | null
  remindersMonthlyBudgetMicros: number | null
  serviceSoftLimit: number | null
  serviceEmergencyLimit: number | null
  pricingMaxAgeDays: number | null
  monitorLastRunAt: Date | null
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function readSendControls(q: Knex | Knex.Transaction = db): Promise<SendControls | null> {
  const r = (await q('platform_whatsapp_send_controls').where({ id: 1 }).first()) as Record<string, unknown> | undefined
  if (!r) return null
  return {
    remindersEnabled: r.remindersEnabled === true,
    trippedAt: r.trippedAt ? new Date(r.trippedAt as string) : null,
    trippedReason: (r.trippedReason as string | null) ?? null,
    billingTimezone: (r.billingTimezone as string | null) ?? null,
    billingCurrency: r.billingCurrency ? String(r.billingCurrency).trim() : null,
    platformDailyCap: Number(r.platformDailyCap),
    recipientDailyCap: Number(r.recipientDailyCap),
    agencyDailyCap: num(r.agencyDailyCap),
    remindersMonthlyBudget: num(r.remindersMonthlyBudget),
    remindersMonthlyBudgetMicros: num(r.remindersMonthlyBudgetMicros),
    serviceSoftLimit: num(r.serviceSoftLimit),
    serviceEmergencyLimit: num(r.serviceEmergencyLimit),
    pricingMaxAgeDays: num(r.pricingMaxAgeDays),
    monitorLastRunAt: r.monitorLastRunAt ? new Date(r.monitorLastRunAt as string) : null,
  }
}

/** Every value sending needs. A NULL one (no explicit approval yet) blocks sending. */
export function missingControls(c: SendControls | null): string[] {
  if (!c) return ['controls_row']
  const missing: string[] = []
  if (!c.billingTimezone) missing.push('billingTimezone')
  if (!c.billingCurrency) missing.push('billingCurrency')
  if (c.agencyDailyCap === null) missing.push('agencyDailyCap')
  if (c.remindersMonthlyBudget === null) missing.push('remindersMonthlyBudget')
  if (c.remindersMonthlyBudgetMicros === null) missing.push('remindersMonthlyBudgetMicros')
  if (c.serviceSoftLimit === null) missing.push('serviceSoftLimit')
  if (c.pricingMaxAgeDays === null) missing.push('pricingMaxAgeDays')
  return missing
}

export async function recordMonitorHeartbeat(now: Date): Promise<void> {
  await db('platform_whatsapp_send_controls').where({ id: 1 }).update({ monitorLastRunAt: now, updatedAt: db.fn.now() })
}

/** Sticky: only the first trip writes. True when THIS call tripped it. */
export async function tripKillSwitch(reason: string, now: Date): Promise<boolean> {
  const rows = await db('platform_whatsapp_send_controls')
    .where({ id: 1 })
    .whereNull('trippedAt')
    .update({ trippedAt: now, trippedReason: reason, updatedAt: db.fn.now() })
    .returning('id')
  return rows.length > 0
}

/**
 * The shared account pause: an account-scope Meta rejection on EITHER
 * owner-reminder system pauses both for an hour (one platform number).
 */
export async function isPlatformSendingPaused(now: Date, q: Knex | Knex.Transaction = db): Promise<boolean> {
  const since = new Date(now.getTime() - ACCOUNT_PAUSE_MS)
  const delivery = await q('owner_whatsapp_reminder_deliveries').where({ status: 'failed', errorScope: 'account' }).where('updatedAt', '>=', since).first('id')
  if (delivery) return true
  const personal = await q('owner_personal_reminders').where({ status: 'failed', errorScope: 'account' }).where('finalizedAt', '>=', since).first('id')
  return !!personal
}
