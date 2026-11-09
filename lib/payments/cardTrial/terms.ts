import { PRICING } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'

/**
 * Card-required trial constants that are either DOCUMENTED by Grow or DECIDED
 * by the owner (2026-09-15).
 *
 * Deliberately absent until Gate B evidence exists (spec §9): the statusCode of
 * a successful token save, and any customer-facing notice about Grow's ₪1 token
 * check — its capture/release behaviour needs Grow's written confirmation.
 */

/** Bump when the customer-facing terms below change; stored with each card setup. */
/**
 * Bumped 2026-09-22 with the subscription-consent wording below, which now
 * names the תקנון explicitly and carries an inline link to it. Rows recorded
 * under '2026-09-15' keep that value: the version says WHICH sentence the
 * customer agreed to, so rewriting it on old rows would misattribute consent.
 */
export const CARD_TRIAL_TERMS_VERSION = '2026-09-22'

/** Owner decision: trials convert to monthly only. */
export const CARD_TRIAL_PERIOD = 'monthly' as const
export const CARD_TRIAL_AMOUNT = PRICING.monthly

/** Grow "Get Token Only" (create-payment-process-6): "Total amount must be 1". */
export const TOKEN_SAVE_SUM = 1

/** Owner decision: access continues after trialEndsAt until the first charge attempt resolves, at most this long. */
export const CONVERSION_GRACE_HOURS = 1
/** Design: a token-billed renewal is attempted up to this long before expiresAt (unused paid time is preserved). */
export const RENEWAL_LEAD_HOURS = 1

/** Sent to Grow: letters, digits and spaces only (Grow forbids special characters). */
export const TOKEN_PROCESS_DESCRIPTION = 'SocialCRM Pro אמצעי תשלום'
export const CHARGE_DESCRIPTION = 'SocialCRM Pro מנוי חודשי'

export function cardTrialTermsLine(): string {
  return `${TRIAL_LENGTH_DAYS} ימים ללא עלות, ולאחר מכן ₪${CARD_TRIAL_AMOUNT} לחודש. אפשר לבטל בכל רגע לפני סיום הניסיון ולא יבוצע חיוב.`
}

/**
 * The subscription disclosure shown BEFORE the redirect, above the primary
 * action (plan Amendment A6 S1). Before activation the trial is described as
 * "7 days from activation" — the exact first-charge date does not exist yet and
 * is shown afterwards from the persisted trial end (firstCharge.ts).
 *
 * Deliberately silent about Grow's ₪1 card check: that copy waits for Grow's
 * written answer (Gate B, B2 / owner decision D3).
 */
/**
 * The ₪1 hold is disclosed because it can APPEAR on a statement, and a customer
 * who sees it without warning reasonably concludes we charged them.
 *
 * Attributed to Grow on purpose. They confirmed in writing (2026-09-17) that
 * saving a token without charging is an authorization hold released within 10
 * days — that is their stated policy, not something we have watched happen on a
 * statement. So the copy says "according to Grow" and "up to", and promises no
 * date. It is named separately from the subscription charge so the two are
 * never read as the same thing.
 */
export const TOKEN_HOLD_NOTICE =
  `לצורך אימות הכרטיס תיתכן הקפאה זמנית של ₪${TOKEN_SAVE_SUM} אצל חברת האשראי. זו אינה גבייה. לפי ספק הסליקה Grow, ההקפאה משתחררת בתוך עד 10 ימים.`

export function cardTrialDisclosureLines(): string[] {
  return [
    `${TRIAL_LENGTH_DAYS} ימים ללא עלות מרגע ההפעלה. היום לא יבוצע חיוב.`,
    TOKEN_HOLD_NOTICE,
    `בתום ${TRIAL_LENGTH_DAYS} הימים יחויב הכרטיס ב־₪${CARD_TRIAL_AMOUNT} לחודש, ומדי חודש לאחר מכן, עד לביטול.`,
    'אפשר לבטל בכל רגע לפני החיוב הראשון בעמוד המנוי ואז לא יבוצע חיוב.',
  ]
}

/** The label of the explicit subscription consent — separate from Grow's card-storage checkbox. */
export const CARD_TRIAL_CONSENT_LABEL =
  'אני מאשר/ת את תנאי השימוש והתקנון, לרבות חיוב חודשי אוטומטי בתום תקופת הניסיון, עד לביטול.'

/**
 * The span of CARD_TRIAL_CONSENT_LABEL the form turns into a link to /terms.
 *
 * Kept as a slice of the label rather than a second copy of the words, so the
 * sentence the customer reads is always the sentence recorded against
 * CARD_TRIAL_TERMS_VERSION. A plain string here, not JSX: this module is
 * imported by server code (startCardSetup) and must stay free of React.
 */
export const CARD_TRIAL_CONSENT_LINK_TEXT = 'תנאי השימוש והתקנון'

/**
 * The SECOND, separate consent: permission to keep the card on file and charge
 * it later. Grow's page asks this too, but their integration guidance is that it
 * must be given explicitly in our interface as well — it is the permission the
 * customer is most entitled to be asked for directly, and it is not the same
 * thing as agreeing to the subscription.
 */
export const CARD_STORAGE_CONSENT_LABEL =
  'אני מאשר/ת שפרטי הכרטיס יישמרו באופן מאובטח אצל ספק הסליקה Grow, ושניתן יהיה לחייב אותו בעתיד עבור המנוי'

export const CARD_STORAGE_CONSENT_VERSION = '2026-09-16'

/**
 * The card-storage consent on the credit purchase path.
 *
 * The subscription wording above is true for a subscription, and false here: a
 * card saved in order to buy credits is never charged on its own. Every pack is
 * a separate purchase the customer confirms at the amount on screen, and saving
 * the card starts no renewal. Its own version, so a stored card records which
 * promise it was saved under.
 */
export const CREDIT_CARD_STORAGE_CONSENT_LABEL =
  'אני מאשר/ת שפרטי הכרטיס יישמרו באופן מאובטח אצל ספק הסליקה Grow לצורך רכישות עתידיות. כל רכישה של חבילת קרדיטים תתבצע רק לאחר אישור מפורש שלי, והסכום שיוצג לי הוא הסכום שיחויב. שמירת הכרטיס אינה מאשרת חיובים אוטומטיים או חידוש מנוי.'

export const CREDIT_CARD_STORAGE_CONSENT_VERSION = '2026-11-08'

/** The wording and version are chosen together, so a screen can never show one and record the other. */
export function cardStorageConsent(returnTo?: 'credits'): { label: string; version: string } {
  return returnTo === 'credits'
    ? { label: CREDIT_CARD_STORAGE_CONSENT_LABEL, version: CREDIT_CARD_STORAGE_CONSENT_VERSION }
    : { label: CARD_STORAGE_CONSENT_LABEL, version: CARD_STORAGE_CONSENT_VERSION }
}

/**
 * What an already-entitled account is told when it adds a first card.
 *
 * The ordinary disclosure promises a seven-day trial and a ₪89 charge at the
 * end of it. For a manually granted Pro workspace both are false: there is no
 * trial to convert and no charge scheduled, because conversion scheduling skips
 * plan='pro' and renewals only follow a paid period that a token charge
 * started. Showing it the standard text would be a plain untruth on the screen
 * where the customer decides whether to trust us with a card.
 */
export function entitledCardAddLines(): string[] {
  return [
    'הגישה שלכם ל-Pro נשמרת כפי שהיא, ואינה תלויה בכרטיס.',
    TOKEN_HOLD_NOTICE,
    'לא נקבע חיוב ולא ייווצר מנוי בעקבות שמירת הכרטיס.',
    'הכרטיס נשמר לשימוש עתידי בלבד, ואפשר להסירו או להחליפו בכל עת.',
  ]
}

/**
 * The single consent this state asks for: permission to KEEP the card. It must
 * not mention a monthly charge at the end of a trial, because neither exists
 * here. Subscription terms are deliberately not requested — needsTerms() is
 * already false for this purpose, so the server does not expect them either.
 */
export const ENTITLED_CARD_STORAGE_CONSENT_LABEL = CARD_STORAGE_CONSENT_LABEL

