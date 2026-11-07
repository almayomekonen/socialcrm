import 'server-only'
import { personalRemindersSendEnabled } from '@/lib/flags/personalReminderFlags'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { missingControls, readSendControls } from '@/db/ownerPersonalReminders/controls'

/**
 * Can a scheduled personal reminder be delivered right now? Used ONLY for what
 * the owner is told ("אשלח לך הודעה כאן" vs "כרגע לא תישלח הודעה"), never to decide
 * a send: the send gate (db/ownerPersonalReminders/dispatchGate.ts) re-checks all
 * of this, and more, at the moment of dispatch.
 *
 * The same switches the delivery tick requires before it claims anything: the
 * environment switch, the DB switch not tripped, every control configured, and
 * platform credentials. Any read failure counts as unavailable: never promise.
 */
export async function reminderDeliveryAvailable(): Promise<boolean> {
  if (!personalRemindersSendEnabled() || !platformWhatsappPhoneNumberId() || !platformWhatsappAccessToken()) return false
  try {
    const c = await readSendControls()
    return !!c && c.remindersEnabled && !c.trippedAt && missingControls(c).length === 0
  } catch {
    return false
  }
}
