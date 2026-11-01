/**
 * The consent the user ticks before a code is issued. The version is recorded
 * with the consent: ANY change to the text must bump the version.
 *
 * One row holds the owner's CURRENT consent (owner_whatsapp_recipients
 * .consentTextVersion):
 *   v2  reminders only. Never consent to the assistant.
 *   v3  reminders AND conversations with the SocialCRM assistant over WhatsApp.
 * Withdrawing the assistant records v2 again (reminders stay on); turning the
 * service off or sending "הסר" stops both.
 */
export const OWNER_WA_CONSENT = {
  version: 'v2',
  text: 'אני מאשר/ת לקבל מ-SocialCRM תזכורות בוואטסאפ על לידים שמחכים למענה, למספר שממנו אשלח את קוד ההפעלה. אפשר להפסיק בכל רגע: לשלוח "הסר" למספר של SocialCRM או לכבות בדף הזה.',
} as const

export const OWNER_WA_ASSISTANT_CONSENT = {
  version: 'v3',
  text:
    'אני מאשר/ת ל-SocialCRM, במספר שממנו אשלח את קוד ההפעלה: ' +
    '(1) לשלוח לי בוואטסאפ תזכורות על לידים שמחכים למענה; ' +
    '(2) לנהל איתי שיחות בוואטסאפ עם העוזר החכם של SocialCRM. ההודעות שאשלח לעוזר מעובדות באמצעות שירותי בינה מלאכותית כדי לנסח תשובות, ' +
    'ולשם כך העוזר קורא את נתוני העסק שלי ב-SocialCRM שיש לי הרשאה לראות, כמו לידים, שיחות עם לקוחות, מעקבים ונתוני מכירות. השאלות והתשובות נשמרות בחשבון. ' +
    'השיחה הזו פרטית ביני לבין העוזר ונפרדת מהשיחות של העסק עם הלקוחות שלו: העוזר עונה רק כשאני כותב/ת לו, לא כותב ללקוחות ולא שולח הודעות בשמי. ' +
    'אפשר להפסיק בכל רגע: לבטל את השיחות עם העוזר בדף הזה (התזכורות ימשיכו), או לשלוח "הסר" למספר של SocialCRM או לכבות בדף הזה כדי להפסיק הכול.',
} as const

export type OwnerWaConsent = typeof OWNER_WA_CONSENT | typeof OWNER_WA_ASSISTANT_CONSENT

/** True only for a recorded consent that covers conversations with the assistant. A reminder-only consent never does. */
export function consentCoversAssistant(version: string | null | undefined): boolean {
  return version === OWNER_WA_ASSISTANT_CONSENT.version
}

/** The consent offered when a code is issued: the assistant's (v3) where it is enabled for the agency, reminders only (v2) elsewhere. */
export function activationConsentFor(assistantEnabled: boolean): OwnerWaConsent {
  return assistantEnabled ? OWNER_WA_ASSISTANT_CONSENT : OWNER_WA_CONSENT
}
