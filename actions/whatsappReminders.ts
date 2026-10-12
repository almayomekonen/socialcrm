'use server'

import { revalidatePath } from 'next/cache'
import { optOutOwnRow, startOwnActivation } from '@/db/ownerWhatsappRecipients'
import { canUseOwnerWhatsappReminders, platformWhatsappWaMeNumber } from '@/lib/flags/ownerWhatsappReminderFlags'
import { AuthError, ProductAccessError, requireAgencyUser, requireProductAccess } from '@/lib/requireUser'
import { OWNER_WA_CONSENT } from '@/lib/whatsapp/platform/consentText'
import { formatActivationCode, generateActivationCode, hashActivationCode } from '@/lib/whatsapp/platform/keys'

/**
 * Owner WhatsApp reminders: consent and opt-out from settings.
 *
 * Identity is the session's (userId + agencyId), never input. Each user acts
 * only on their own row. Nothing here sends a WhatsApp message: the user sends
 * the code from their own phone, and the webhook binds the number Meta reports.
 */

const CODE_TTL_MS = 15 * 60 * 1000
const PATH = '/settings/whatsapp_reminders'

export type StartActivationResult = { ok: true; code: string; waMeHref: string } | { fail: true; msg: string }

export async function startWhatsappReminderActivation(input: { consent?: unknown }): Promise<StartActivationResult> {
  let user
  try {
    user = await requireProductAccess()
  } catch (err) {
    if (err instanceof AuthError || err instanceof ProductAccessError) return { fail: true, msg: 'אין הרשאה להפעיל תזכורות' }
    throw err
  }
  const waMe = platformWhatsappWaMeNumber()
  if (!canUseOwnerWhatsappReminders(user.agencyId) || !waMe) return { fail: true, msg: 'התזכורות אינן זמינות לחשבון זה' }
  if (input?.consent !== true) return { fail: true, msg: 'כדי להמשיך צריך לאשר קבלת תזכורות' }

  // A code collision with another live code is astronomically rare; the unique
  // index turns it into an error, and a fresh code is drawn.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateActivationCode()
    try {
      const outcome = await startOwnActivation({
        agencyId: user.agencyId,
        userId: user.id,
        codeHash: hashActivationCode(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        consentTextVersion: OWNER_WA_CONSENT.version,
      })
      if (outcome === 'already_active') return { fail: true, msg: 'התזכורות כבר פעילות' }
      revalidatePath(PATH)
      const shown = formatActivationCode(code)
      const text = `הפעלת תזכורות SocialCRM: ${shown}`
      return { ok: true, code: shown, waMeHref: `https://wa.me/${waMe}?text=${encodeURIComponent(text)}` }
    } catch (err) {
      if ((err as { code?: string })?.code !== '23505') throw err
    }
  }
  return { fail: true, msg: 'לא ניתן ליצור קוד הפעלה. נסו שוב.' }
}

/**
 * Turn reminders off for the session's own row. Allowed whatever the rollout or
 * subscription state: stopping must always work.
 */
export async function turnOffWhatsappReminders(): Promise<{ ok: true } | { fail: true; msg: string }> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { fail: true, msg: 'אין הרשאה' }
    throw err
  }
  await optOutOwnRow(user.agencyId, user.id)
  revalidatePath(PATH)
  return { ok: true }
}
