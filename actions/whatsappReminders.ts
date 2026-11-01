'use server'

import { revalidatePath } from 'next/cache'
import { getOwnRecipient, optOutOwnRow, setOwnActiveConsent, startOwnActivation } from '@/db/ownerWhatsappRecipients'
import { canUseOwnerWhatsappReminders, platformWhatsappWaMeNumber } from '@/lib/flags/ownerWhatsappReminderFlags'
import { isWaAssistantAgency } from '@/lib/flags/waAssistantFlags'
import { AuthError, ProductAccessError, requireAgencyUser, requireProductAccess } from '@/lib/requireUser'
import {
  OWNER_WA_ASSISTANT_CONSENT,
  OWNER_WA_CONSENT,
  activationConsentFor,
  consentCoversAssistant,
} from '@/lib/whatsapp/platform/consentText'
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
const STALE_CONSENT = 'נוסח ההסכמה התעדכן. רעננו את הדף ואשרו שוב.'

export type StartActivationResult = { ok: true; code: string; waMeHref: string } | { fail: true; msg: string }

/**
 * `consentVersion` is the version of the sentence the page SHOWED. It must be
 * the one recorded now (v3 where the assistant is enabled for the agency, v2
 * elsewhere), so a consent is never recorded for a text the user did not see.
 * Absent means the reminders-only text (pages that predate v3).
 */
export async function startWhatsappReminderActivation(input: {
  consent?: unknown
  consentVersion?: unknown
}): Promise<StartActivationResult> {
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
  const consentToRecord = activationConsentFor(isWaAssistantAgency(user.agencyId))
  const shown = input.consentVersion ?? OWNER_WA_CONSENT.version
  if (shown !== consentToRecord.version) return { fail: true, msg: STALE_CONSENT }

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
        consentTextVersion: consentToRecord.version,
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

/**
 * Consent to conversations with the SocialCRM assistant on an ALREADY verified
 * number (a v2, reminders-only row): records v3 on the session's own active
 * row. A reminder-only consent is never upgraded by anything else.
 */
export async function grantWhatsappAssistantConsent(input: {
  consent?: unknown
  consentVersion?: unknown
}): Promise<{ ok: true } | { fail: true; msg: string }> {
  let user
  try {
    user = await requireProductAccess()
  } catch (err) {
    if (err instanceof AuthError || err instanceof ProductAccessError) return { fail: true, msg: 'אין הרשאה' }
    throw err
  }
  if (!canUseOwnerWhatsappReminders(user.agencyId) || !isWaAssistantAgency(user.agencyId)) {
    return { fail: true, msg: 'העוזר אינו זמין לחשבון זה' }
  }
  if (input?.consent !== true) return { fail: true, msg: 'כדי להמשיך צריך לאשר שיחות עם העוזר' }
  if (input.consentVersion !== OWNER_WA_ASSISTANT_CONSENT.version) return { fail: true, msg: STALE_CONSENT }
  if (!(await setOwnActiveConsent(user.agencyId, user.id, OWNER_WA_ASSISTANT_CONSENT.version))) {
    return { fail: true, msg: 'קודם צריך להפעיל ולאמת את המספר' }
  }
  revalidatePath(PATH)
  return { ok: true }
}

/**
 * Stop the assistant, keep reminders: the session's own active row goes back to
 * the reminders-only consent (v2). Allowed whatever the rollout or subscription
 * state, like turning reminders off: stopping must always work.
 */
export async function withdrawWhatsappAssistantConsent(): Promise<{ ok: true } | { fail: true; msg: string }> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { fail: true, msg: 'אין הרשאה' }
    throw err
  }
  const row = await getOwnRecipient(user.agencyId, user.id)
  if (row && consentCoversAssistant(row.consentTextVersion)) {
    await setOwnActiveConsent(user.agencyId, user.id, OWNER_WA_CONSENT.version)
  }
  revalidatePath(PATH)
  return { ok: true }
}
