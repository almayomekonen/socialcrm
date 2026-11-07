/**
 * The consent the user ticks before a code is issued. The version is recorded
 * with the consent: ANY change to the text must bump the version.
 *
 * One row holds the owner's CURRENT consent (owner_whatsapp_recipients
 * .consentTextVersion):
 *   v2  reminders only. Never consent to the assistant.
 *   v3  reminders AND conversations with the SocialCRM assistant over WhatsApp
 *       (live 2026-11-01). Still valid; never rewritten.
 *   v4  the same, stating explicitly that the assistant reads ONLY the
 *       business the number is connected to, and only what the owner's role
 *       permits. Recorded for every new assistant consent.
 *   v5  v4 PLUS personal reminders the owner asks the assistant for, sent at
 *       the time asked even outside a conversation (Reminder Engine). Granted
 *       ONLY by an explicit choice in Settings; never recorded at activation
 *       and never inferred from v4.
 * Withdrawing personal reminders records v4 again; withdrawing the assistant
 * records v2 (reminders about waiting leads stay on); turning the service off
 * or sending "הסר" stops everything. Each of these cancels future personal
 * reminders in the same transaction (db/ownerPersonalReminders/consent.ts).
 */
export const OWNER_WA_CONSENT = {
  version: 'v2',
  text: 'אני מאשר/ת לקבל מ-SocialCRM תזכורות בוואטסאפ על לידים שמחכים למענה, למספר שממנו אשלח את קוד ההפעלה. אפשר להפסיק בכל רגע: לשלוח "הסר" למספר של SocialCRM או לכבות בדף הזה.',
} as const

export const OWNER_WA_ASSISTANT_CONSENT = {
  version: 'v4',
  text:
    'אני מאשר/ת ל-SocialCRM, במספר שממנו אשלח את קוד ההפעלה: ' +
    '(1) לשלוח לי בוואטסאפ תזכורות על לידים שמחכים למענה; ' +
    '(2) לנהל איתי שיחות בוואטסאפ עם העוזר החכם של SocialCRM. ההודעות שאשלח לעוזר מעובדות באמצעות שירותי בינה מלאכותית כדי לנסח תשובות, ' +
    'ולשם כך העוזר קורא רק נתונים של העסק שהמספר הזה מחובר אליו ב-SocialCRM, ורק את מה שמותר לי לראות לפי ההרשאות של התפקיד שלי, כמו לידים, שיחות עם לקוחות, מעקבים ונתוני מכירות. השאלות והתשובות נשמרות בחשבון. ' +
    'השיחה הזו פרטית ביני לבין העוזר ונפרדת מהשיחות של העסק עם הלקוחות שלו: העוזר עונה רק כשאני כותב/ת לו, לא כותב ללקוחות ולא שולח הודעות בשמי. ' +
    'אפשר להפסיק בכל רגע: לבטל את השיחות עם העוזר בדף הזה (התזכורות ימשיכו), או לשלוח "הסר" למספר של SocialCRM או לכבות בדף הזה כדי להפסיק הכול.',
} as const

/**
 * v5: the assistant consent (v4) plus personal reminders.
 *
 * DRAFT WORDING, NOT LEGALLY APPROVED (architecture v1.4 F4). It must pass
 * legal review before any agency is offered it. Changing it after anyone has
 * recorded it requires a new version. It is offered only where
 * WA_ASSISTANT_REMINDERS_AGENCY_IDS names the agency (absent = nobody).
 */
export const OWNER_WA_PERSONAL_REMINDERS_CONSENT = {
  version: 'v5',
  text:
    'אני מאשר/ת ל-SocialCRM, במספר שממנו אשלח את קוד ההפעלה: ' +
    '(1) לשלוח לי בוואטסאפ תזכורות על לידים שמחכים למענה; ' +
    '(2) לנהל איתי שיחות בוואטסאפ עם העוזר החכם של SocialCRM. ההודעות שאשלח לעוזר מעובדות באמצעות שירותי בינה מלאכותית כדי לנסח תשובות, ' +
    'ולשם כך העוזר קורא רק נתונים של העסק שהמספר הזה מחובר אליו ב-SocialCRM, ורק את מה שמותר לי לראות לפי ההרשאות של התפקיד שלי. השאלות והתשובות נשמרות בחשבון; ' +
    '(3) לשלוח לי בוואטסאפ, למספר הזה בלבד, תזכורות אישיות שביקשתי מהעוזר, במועד שביקשתי, גם כשאני לא בשיחה איתו באותו רגע. תזכורת נשלחת רק אליי, ולעולם לא ללקוח או לליד שמוזכר בה. ' +
    'מלבד תזכורות שביקשתי, העוזר כותב לי רק כשאני כותב/ת לו, לא כותב ללקוחות ולא שולח הודעות בשמי. ' +
    'שליחת הודעות בוואטסאפ כרוכה בעלויות ש-Meta גובה מ-SocialCRM, ולכן SocialCRM רשאית להגביל את מספר התזכורות או להפסיק את שליחתן. תזכורת עלולה להגיע באיחור קצר, ובמקרים מסוימים לא להגיע; במקרה כזה אקבל הודעה ב-SocialCRM. ' +
    'אפשר להפסיק בכל רגע: להפסיק רק את התזכורות האישיות בדף הזה (השיחות עם העוזר ימשיכו); לבטל את השיחות עם העוזר (גם התזכורות האישיות ייפסקו); או לשלוח "הסר" למספר של SocialCRM כדי להפסיק הכול.',
} as const

export type OwnerWaConsent = typeof OWNER_WA_CONSENT | typeof OWNER_WA_ASSISTANT_CONSENT | typeof OWNER_WA_PERSONAL_REMINDERS_CONSENT

/**
 * Recorded versions that consent to conversations with the assistant: the
 * current text, v3, whose wording already limited the assistant to data the
 * owner may see (v4 only makes that explicit), and v5, which contains v4 in
 * full. A reminder-only consent (v2) never counts. To require v3 holders to
 * consent again, drop 'v3' here.
 */
export const ASSISTANT_CONSENT_VERSIONS: readonly string[] = ['v3', OWNER_WA_ASSISTANT_CONSENT.version, OWNER_WA_PERSONAL_REMINDERS_CONSENT.version]

/** True only for a recorded consent that covers conversations with the assistant. A reminder-only consent never does. */
export function consentCoversAssistant(version: string | null | undefined): boolean {
  return !!version && ASSISTANT_CONSENT_VERSIONS.includes(version)
}

/** Versions that cover PERSONAL reminders: v5 only. v4 never silently counts. */
export const PERSONAL_REMINDER_CONSENT_VERSIONS: readonly string[] = [OWNER_WA_PERSONAL_REMINDERS_CONSENT.version]

/** True only for a recorded consent to personal reminders (v5). Every reminder send fails closed without it. */
export function consentCoversPersonalReminders(version: string | null | undefined): boolean {
  return !!version && PERSONAL_REMINDER_CONSENT_VERSIONS.includes(version)
}

/** The consent offered when a code is issued: the assistant's (current) where it is enabled for the agency, reminders only (v2) elsewhere. */
export function activationConsentFor(assistantEnabled: boolean): OwnerWaConsent {
  return assistantEnabled ? OWNER_WA_ASSISTANT_CONSENT : OWNER_WA_CONSENT
}
