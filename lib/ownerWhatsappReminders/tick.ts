import { findReminderCandidates, loadActiveRecipients } from '@/db/ownerWhatsappReminders/candidates'
import { claimDueDeliveries, finalizeReminders, isSendingPaused, reapStaleSending } from '@/db/ownerWhatsappReminders/deliveries'
import { scheduleReminder } from '@/db/ownerWhatsappReminders/schedule'
import { quietHoursByAgency } from '@/db/notifications/unanswered'
import { nextAllowedAfterQuietHours } from '@/lib/inbox/autoresponse/noResponseClose'
import {
  hasOwnerWhatsappReminderAudience,
  isOwnerWhatsappReminderSendEnabled,
  ownerWhatsappReminderAudience,
  platformWhatsappAccessToken,
  platformWhatsappPhoneNumberId,
} from '@/lib/flags/ownerWhatsappReminderFlags'
import { agenciesWithReminderAccess } from './productAccess'
import { CANDIDATES_PER_TICK, SENDS_PER_TICK } from './constants'
import { selectReminderRecipients } from './selectRecipients'
import { sendClaimedDelivery, type DeliveryResult } from './sendDelivery'

/**
 * Owner WhatsApp reminders tick, run every minute by
 * app/api/cron/owner-wa-reminders.
 *
 * OFF BY DEFAULT, IN LAYERS:
 *   - no platform number or an empty audience: logs a single 'disabled' line
 *     (booleans and counts only) and returns at once, no query;
 *   - OWNER_WA_REMINDERS_SEND_ENABLED !== '1' (the kill switch): DRY RUN. It
 *     finds candidates and recipients and logs counts, and writes NOTHING (so a
 *     dry run can never use up a cooldown or a reminder);
 *   - no access token: as a dry run, plus a logged reason.
 *
 * Phase 1 schedules: one reminder per hand-off with its deliveries (quiet hours
 * set their first attempt time), only for agencies with product access (PAID,
 * TRIAL_ACTIVE, LEGACY; failing closed). The sender checks access again
 * immediately before each send. Phase 2 sends due deliveries, at most
 * SENDS_PER_TICK, unless an account-wide rejection paused sending.
 */
export type ReminderTickSummary = {
  mode: 'disabled' | 'dry_run' | 'live'
  candidates: number
  scheduled: number
  noRecipients: number
  noAccess: number
  wouldRemind: number
  reaped: number
  paused: boolean
  sends: Partial<Record<DeliveryResult, number>>
}

export async function tickOwnerWhatsappReminders(opts?: { now?: Date }): Promise<ReminderTickSummary> {
  const now = opts?.now ?? new Date()
  const summary: ReminderTickSummary = { mode: 'disabled', candidates: 0, scheduled: 0, noRecipients: 0, noAccess: 0, wouldRemind: 0, reaped: 0, paused: false, sends: {} }
  const phoneNumberId = platformWhatsappPhoneNumberId()
  const audience = ownerWhatsappReminderAudience()
  if (!phoneNumberId || !hasOwnerWhatsappReminderAudience(audience)) {
    console.log('[OwnerWaReminder][tick] disabled', {
      platformNumberConfigured: !!phoneNumberId,
      audience: audience.mode,
      allowlistedAgencies: audience.mode === 'list' ? audience.agencyIds.length : null,
    })
    return summary
  }

  const token = platformWhatsappAccessToken()
  const live = isOwnerWhatsappReminderSendEnabled() && !!token
  summary.mode = live ? 'live' : 'dry_run'
  if (isOwnerWhatsappReminderSendEnabled() && !token) console.error('[OwnerWaReminder][tick] send enabled but PLATFORM_WHATSAPP_ACCESS_TOKEN is missing: dry run')

  const found = await findReminderCandidates(now, audience, CANDIDATES_PER_TICK)
  summary.candidates = found.length
  const withAccess = await agenciesWithReminderAccess(found.map((c) => c.agencyId), now)
  const candidates = found.filter((c) => withAccess.has(c.agencyId))
  summary.noAccess = found.length - candidates.length
  const recipientsByAgency = await loadActiveRecipients([...new Set(candidates.map((c) => c.agencyId))])
  const quiet = await quietHoursByAgency([...new Set(candidates.map((c) => c.agencyId))])

  for (const candidate of candidates) {
    const recipients = selectReminderRecipients({
      handlerUserId: candidate.handlerUserId,
      escalatedAt: candidate.escalatedAt,
      customerWaId: candidate.customerWaId,
      recipients: recipientsByAgency.get(candidate.agencyId) ?? [],
    })
    if (!recipients.length) {
      summary.noRecipients++
      continue
    }
    summary.wouldRemind++
    if (!live) continue
    try {
      const outcome = await scheduleReminder({
        candidate,
        recipientIds: recipients.map((r) => r.recipientId),
        agencyIds: audience,
        notBefore: nextAllowedAfterQuietHours(quiet.get(candidate.agencyId), now),
        now,
      })
      if (outcome === 'scheduled') summary.scheduled++
    } catch (err) {
      console.error('[OwnerWaReminder][tick] schedule failed', { conversationId: candidate.conversationId, code: (err as { code?: string })?.code ?? null })
    }
  }

  if (!live) {
    console.log('[OwnerWaReminder][tick] dry run', { candidates: summary.candidates, wouldRemind: summary.wouldRemind, noRecipients: summary.noRecipients, noAccess: summary.noAccess })
    return summary
  }

  summary.reaped = await reapStaleSending(now)
  summary.paused = await isSendingPaused(now)
  if (!summary.paused) {
    const claimed = await claimDueDeliveries(now, SENDS_PER_TICK)
    const quietForSends = await quietHoursByAgency([...new Set(claimed.map((d) => d.agencyId))])
    for (const delivery of claimed) {
      try {
        const result = await sendClaimedDelivery({ delivery, agencyIds: audience, quietHours: quietForSends.get(delivery.agencyId), phoneNumberId, accessToken: token!, now })
        summary.sends[result] = (summary.sends[result] ?? 0) + 1
      } catch (err) {
        // The delivery stays `sending` and is reaped to `unknown`: never resent.
        console.error('[OwnerWaReminder][tick] send step failed', { deliveryId: delivery.id, code: (err as { code?: string })?.code ?? null })
      }
    }
  } else {
    console.error('[OwnerWaReminder][tick] sending paused after an account-wide rejection')
  }
  await finalizeReminders()
  console.log('[OwnerWaReminder][tick]', summary)
  return summary
}
