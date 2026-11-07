import 'server-only'
import { db } from '@/config/db'
import { sendPlatformText } from '@/lib/whatsapp/platform/sendText'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { personalRemindersSendEnabled, REMINDER_CLAIMS_PER_TICK } from '@/lib/flags/personalReminderFlags'
import { expireReminderDrafts } from '@/db/ownerPersonalReminders/expireDrafts'
import { isPlatformSendingPaused, missingControls, readSendControls } from '@/db/ownerPersonalReminders/controls'
import { enterDispatch } from '@/db/ownerPersonalReminders/dispatchGate'
import {
  claimDueReminders,
  purgeReminderText,
  reapStaleClaims,
  reapStaleDispatches,
  recordSendOutcome,
  releaseForFailedStatuses,
} from '@/db/ownerPersonalReminders/lifecycle'
import { reconcileReminderActions } from '@/lib/reminders/reconcileSweep'
import { runMonitor } from './monitor'
import { reminderAlert } from './alerts'

/**
 * One personal-reminder cron tick (Reminder Engine Phase 5).
 *
 *   1. the monitor, always (exposure, heartbeat, emergency trip);
 *   2. housekeeping, always, never sending: draft expiry (T12), stale claims
 *      (T10), stale dispatches → unknown (T11), cost release for Meta `failed`
 *      statuses, the 90-day text purge (T13), action reconciliation (T16);
 *   3. sending, only when ALL of these hold:
 *        OWNER_PERSONAL_REMINDERS_SEND_ENABLED=1 (otherwise a dry run);
 *        the DB switch `remindersEnabled`, not tripped;
 *        every control configured;
 *        platform credentials present;
 *        the account not paused;
 *        exposure measured;
 *      then claim → gate → Graph call (NO transaction open) → record.
 *
 * `send` is injectable so tests never call Meta. Operator alerts: ./alerts.ts.
 */

export type TickSummary = {
  mode: 'dry_run' | 'blocked' | 'live'
  blockedBy?: string[]
  exposure: number | null
  due?: number
  claimed: number
  sent: number
  failed: number
  unknown: number
  deferred: number
  cancelled: number
}

export async function tickPersonalReminders(deps: { send?: typeof sendPlatformText; nowMs?: () => number } = {}): Promise<TickSummary> {
  const nowMs = (deps.nowMs ?? Date.now)()
  const monitor = await runMonitor(nowMs)

  await expireReminderDrafts(new Date(nowMs))
  await reapStaleClaims(nowMs)
  const staleUnknown = await reapStaleDispatches(nowMs)
  if (staleUnknown > 0) reminderAlert('send_unknown', { count: staleUnknown, reason: 'lease_expired' })
  await releaseForFailedStatuses()
  await purgeReminderText(nowMs)
  await reconcileReminderActions(nowMs)

  const summary: TickSummary = { mode: 'dry_run', exposure: monitor.exposure, claimed: 0, sent: 0, failed: 0, unknown: 0, deferred: 0, cancelled: 0 }
  if (!personalRemindersSendEnabled()) {
    // The database switch ON while the environment switch is off: delivery silently stays a dry run.
    if ((await readSendControls())?.remindersEnabled) reminderAlert('enabled_blocked', { blockedBy: ['env_switch_off'] })
    const due = await db('owner_personal_reminders').where({ status: 'scheduled' }).where('nextAttemptAt', '<=', new Date(nowMs)).count<{ n: string }[]>('* as n')
    return { ...summary, due: Number(due[0].n) }
  }

  const c = await readSendControls()
  const phoneNumberId = platformWhatsappPhoneNumberId()
  const accessToken = platformWhatsappAccessToken()
  const blockedBy = [
    ...(!c?.remindersEnabled ? ['disabled'] : []),
    ...(c?.trippedAt ? ['kill_switch'] : []),
    ...missingControls(c),
    ...(!phoneNumberId || !accessToken ? ['platform_credentials'] : []),
    ...(monitor.exposure === null ? ['monitor'] : []),
    ...((await isPlatformSendingPaused(new Date(nowMs))) ? ['account_paused'] : []),
  ]
  // Switched ON in the database but unable to run: an operator must know (never silent).
  if (blockedBy.length && c?.remindersEnabled && !c.trippedAt) reminderAlert('enabled_blocked', { blockedBy })
  if (blockedBy.length) return { ...summary, mode: 'blocked', blockedBy }

  const send = deps.send ?? sendPlatformText
  const claims = await claimDueReminders(nowMs, REMINDER_CLAIMS_PER_TICK)
  const live: TickSummary = { ...summary, mode: 'live', claimed: claims.length }
  for (const claim of claims) {
    const gate = await enterDispatch({ reminderId: claim.id, claimToken: claim.claimToken, nowMs, exposure: monitor.exposure })
    if (gate.result === 'deferred') {
      live.deferred++
      reminderAlert('delivery_deferred', { reminderId: claim.id, reason: gate.reason })
    } else if (gate.result === 'cancelled') live.cancelled++
    else if (gate.result === 'failed') {
      live.failed++
      reminderAlert('gate_failed', { reminderId: claim.id, reason: gate.reason })
    }
    if (gate.result !== 'dispatching') continue
    // The point of no return is committed; no transaction is open for the Graph call.
    const outcome = await send({ phoneNumberId: phoneNumberId as string, accessToken: accessToken as string, toE164: gate.toE164, body: gate.body, jobId: claim.id })
    const recorded = await recordSendOutcome({ reminderId: claim.id, claimToken: claim.claimToken, outcome, nowMs })
    if (recorded === 'sent') live.sent++
    else if (recorded === 'unknown') {
      live.unknown++
      reminderAlert('send_unknown', { reminderId: claim.id, reason: outcome.kind === 'unknown' ? outcome.reason : null })
    } else if (recorded === 'failed') {
      live.failed++
      reminderAlert('send_failed', { reminderId: claim.id, scope: outcome.kind === 'rejected' ? outcome.scope : null, code: outcome.kind === 'rejected' ? outcome.code : null })
    }
  }
  console.log('[personal-reminders] tick', { mode: live.mode, claimed: live.claimed, sent: live.sent, failed: live.failed, unknown: live.unknown, deferred: live.deferred, cancelled: live.cancelled })
  return live
}
