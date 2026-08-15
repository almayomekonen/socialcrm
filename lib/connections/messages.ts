/**
 * Approved user-facing copy for the Facebook and WhatsApp connection flows.
 *
 * Single source of truth for connection messaging. FacebookConnect and
 * WhatsappConnect both read from here; nothing else defines connection copy.
 * The wording is final and approved — do not reword it in a component.
 *
 * Shape mirrors the approved structure: title, one-sentence explanation, up to
 * three reason fragments, one next-step sentence, and CTA labels.
 *
 * NOTE ON CTAs: several approved secondary actions point at destinations that
 * do not exist in the product yet (support contact, Meta settings, WhatsApp
 * Manager, Facebook page settings). Their labels are recorded so the copy is
 * complete, but a component renders a button only when it already owns the
 * matching handler. No new destinations were invented.
 *
 * Keys are the codes the existing routes already emit. Error detection was not
 * changed — this is a copy-only layer.
 */
export type ConnectionNotice = {
  title: string
  explanation: string
  reasons?: string[]
  nextStep?: string
  /** Primary CTA label. Rendered by the caller only when it owns a handler. */
  action?: string
  /**
   * Secondary CTA label. RESERVED — deliberately never rendered today. Each of
   * these points at a destination the product does not have yet: a support
   * contact route, Facebook page settings, Meta billing settings, WhatsApp
   * Manager. The approved labels are kept here so the copy is not lost; wiring
   * one means adding its destination first.
   */
  secondary?: string
  /** 'error' — something failed. 'attention' — connected, but needs a step. */
  tone: 'error' | 'attention'
}

/**
 * Shared phrases. Repeated deliberately across messages so the set reads as
 * one system; defined once so they cannot drift.
 */
export const SHARED = {
  nothingLost: 'לא נשמר ולא השתנה מידע כלשהו.',
  noActionNeeded: 'לא נדרשת פעולה כלשהי. נעדכן עם חזרת השירות.',
  retry: 'לנסות שוב',
  reconnect: 'לחבר מחדש',
  support: 'לפנות לתמיכה',
  reasonsLabel: 'בדרך כלל בגלל:',
} as const

/**
 * Facebook. Keys match `?error=` values from the OAuth callback, plus the
 * connect-result and health states the component sets directly.
 *
 * ADDING A CODE: add the entry here and nothing else — both components resolve
 * through facebookNotice()/whatsappNotice(), so a new key is picked up with no
 * component change. An unmapped code falls back rather than rendering nothing,
 * so a missing entry degrades quietly instead of breaking.
 */
export const FACEBOOK_NOTICES: Record<string, ConnectionNotice> = {
  denied: {
    tone: 'error',
    title: 'החיבור לפייסבוק לא הושלם',
    explanation: 'התהליך נעצר לפני שלב האישור, ולא נשמר מידע.',
    reasons: ['חלון פייסבוק נסגר', 'נבחרה אפשרות הביטול'],
    nextStep: 'אפשר להתחיל את החיבור מחדש.',
    action: 'להתחבר לפייסבוק',
  },
  missing_permission: {
    tone: 'error',
    title: 'חסרה הרשאה לקבלת לידים',
    explanation: 'החיבור הושלם, אך ללא ההרשאה הזו לא ניתן למשוך לידים מהמודעות.',
    reasons: ['אחת ההרשאות לא סומנה במסך האישור'],
    nextStep: 'להתחבר שוב ולאשר את כל ההרשאות המבוקשות.',
    action: 'להתחבר ולאשר',
  },
  no_pages: {
    tone: 'error',
    // We do NOT assert "you have no Page" — an empty result does not prove that.
    title: 'לא מצאנו דף Facebook שאפשר לחבר',
    explanation: 'התחברנו לחשבון Facebook, אבל לא קיבלנו ממנו דף שאפשר לחבר ל-SocialCRM.',
    reasons: [
      'ייתכן שההתחברות בוצעה עם חשבון שאינו מנהל את הדף',
      'ייתכן שהדף לא נבחר במסך האישור של Facebook',
      'אם עדיין אין דף עסקי — צריך ליצור אחד',
    ],
    nextStep: 'כדאי לוודא שאתם מחוברים לחשבון שמנהל את הדף ולבחור בו במסך האישור, ואז לנסות שוב.',
    // Non-conclusive CTA — we do not assert the account is the cause.
    action: 'בדקתי את הדף והגישה, לנסות להתחבר שוב',
  },
  // Escalated variant — shown after a repeated identical no-Page result in the
  // same setup session. Reframes retry as intentional recovery, not repetition.
  no_pages_repeat: {
    tone: 'attention',
    title: 'נראה שהחיבור עדיין לא מוצא דף מתאים',
    explanation:
      'התחברות נוספת עם אותו חשבון ואותן הרשאות צפויה להביא לאותה תוצאה. כדי שזה יעבוד, צריך קודם לשנות משהו בצד של Facebook.',
    reasons: [
      'לוודא שאתם מחוברים לחשבון ה-Facebook שמנהל את הדף',
      'לבדוק שיש לכם הרשאת ניהול לדף',
      'לבחור את הדף במפורש במסך האישור של Facebook',
    ],
    nextStep: 'אחרי שווידאתם את הגישה לדף — אפשר לנסות להתחבר שוב.',
    action: 'בדקתי את הגישה לדף, לנסות שוב',
  },
  pages_permission: {
    tone: 'error',
    title: 'חסרה הרשאה להצגת הדפים שלך',
    explanation: 'כדי לחבר דף, SocialCRM צריך הרשאה לראות אילו דפים זמינים בחשבון שלכם. ההרשאה הזו לא אושרה.',
    reasons: ['אחת ההרשאות לא סומנה במסך האישור של Facebook'],
    nextStep: 'להתחבר שוב ולאשר את כל ההרשאות המבוקשות.',
    action: 'להתחבר ולאשר הרשאות',
  },
  resource_claimed: {
    tone: 'error',
    title: 'הדף כבר מחובר לחשבון אחר',
    explanation: 'דף ה-Facebook הזה כבר מחובר לחשבון SocialCRM אחר. כדי למנוע כפילות, אי אפשר לחבר אותו לשני חשבונות במקביל.',
    reasons: ['ייתכן שהדף חובר בעבר מחשבון אחר שלכם'],
    nextStep: 'אם הדף שייך לכם, יש לנתקו מהחשבון האחר תחילה ואז לחבר כאן.',
  },
  token: {
    tone: 'error',
    title: 'החיבור נקטע לפני השלמתו',
    explanation: 'האישור מפייסבוק התקבל, אך החיבור לא הושלם ולא נשמר מידע חלקי.',
    reasons: ['התהליך ארך זמן רב', 'תקלה רגעית'],
    nextStep: 'לנסות שוב ולהשלים את השלבים ברצף.',
    action: SHARED.retry,
    secondary: SHARED.support,
  },
  state: {
    tone: 'error',
    title: 'תוקף תהליך החיבור פג',
    explanation: 'התהליך תקף לעשר דקות, וחלף זמן רב יותר. לא בוצע שינוי כלשהו.',
    reasons: ['מסך האישור נשאר פתוח', 'ההתחברות החלה בחלון אחר'],
    nextStep: 'להתחיל את החיבור מחדש — התהליך אורך פחות מדקה.',
    action: 'להתחיל מחדש',
  },
  no_code: {
    tone: 'error',
    title: 'החיבור לא הושלם',
    explanation: 'החזרה מפייסבוק בוצעה ללא האישור הנדרש.',
    reasons: ['החלון נסגר לפני סיום התהליך'],
    nextStep: 'להתחיל את החיבור מחדש.',
    action: 'להתחיל מחדש',
  },
  subscription_failed: {
    tone: 'error',
    title: 'הדף לא נרשם לקבלת לידים',
    explanation: 'פייסבוק לא אישרה קבלת לידים מהדף, ולכן העדפנו לא לשמור חיבור שלא יביא לידים.',
    reasons: ['הרשאת ניהול חלקית', 'הגבלות ב-Business Manager'],
    nextStep: 'לוודא הרשאת מנהל מלאה לדף ולנסות שוב.',
    action: SHARED.retry,
    secondary: 'בדיקת הרשאות',
  },
  save_failed: {
    tone: 'error',
    title: 'החיבור לא נשמר',
    explanation: 'מדובר בתקלה במערכת שלנו. בפייסבוק לא בוצע שינוי כלשהו.',
    reasons: ['עומס רגעי במערכת'],
    nextStep: 'לנסות שוב כעת.',
    action: SHARED.retry,
  },
  expired: {
    tone: 'attention',
    title: 'החיבור לפייסבוק פג',
    explanation: 'לידים חדשים אינם נכנסים כרגע. כל המידע הקיים במערכת נשמר במלואו.',
    reasons: ['חלפו כ-60 יום מהחיבור', 'הסיסמה בפייסבוק שונתה'],
    nextStep: 'חידוש החיבור אורך פחות מדקה ואינו משפיע על נתונים קיימים.',
    action: SHARED.reconnect,
  },
  repairing: {
    tone: 'attention',
    title: 'החיבור מתעדכן — לא נדרשת פעולה',
    explanation: 'קבלת הלידים מהדף הופסקה, והמערכת מחדשת אותה אוטומטית.',
    reasons: ['הגדרות האפליקציה בדף אופסו בפייסבוק'],
    nextStep: 'אם ההודעה תופיע גם מחר, כדאי לחבר מחדש.',
  },
}

/**
 * WhatsApp. Keys match embedded-signup result codes plus `?wa_error=` values.
 *
 * `token` intentionally shares its title with the Facebook entry of the same
 * name — same situation, channel-specific explanation. Not a duplicate.
 *
 * `missing_details` is RESERVED and currently unreachable: the server returns
 * the literal string `Missing fields`, which the client maps to `server` and
 * therefore falls back to `token`. Routing it correctly is a one-line change
 * to the error code the route returns — deliberately out of scope for a
 * copy-only pass.
 */
export const WHATSAPP_NOTICES: Record<string, ConnectionNotice> = {
  sdk: {
    tone: 'error',
    title: 'חלון ההתחברות לא נפתח',
    explanation: 'הדפדפן חסם את רכיב ההתחברות של פייסבוק.',
    reasons: ['חוסם פרסומות', 'הגדרת פרטיות מחמירה'],
    nextStep: 'להשבית זמנית את החוסם, או לנסות בדפדפן אחר.',
    action: SHARED.retry,
  },
  config: {
    tone: 'error',
    title: 'החיבור לוואטסאפ אינו זמין כרגע',
    explanation: 'חסרה הגדרה במערכת שלנו, והטיפול בה כבר החל. אין לכך קשר לחשבון שלך.',
    nextStep: SHARED.noActionNeeded,
    secondary: SHARED.support,
  },
  token: {
    tone: 'error',
    title: 'החיבור נקטע לפני השלמתו',
    explanation: 'האישור מ-Meta התקבל, אך החיבור לא הושלם.',
    reasons: ['התהליך ארך זמן רב'],
    nextStep: 'לנסות שוב ולהשלים את השלבים ברצף.',
    action: SHARED.retry,
  },
  network: {
    tone: 'error',
    title: 'החיבור לאינטרנט נקטע',
    explanation: `הפעולה לא הושלמה. ${SHARED.nothingLost}`,
    reasons: ['הפרעה זמנית ברשת'],
    nextStep: 'לבדוק את חיבור האינטרנט ולנסות שוב.',
    action: SHARED.retry,
  },
  missing_details: {
    tone: 'error',
    title: 'פרטי החשבון לא התקבלו',
    explanation: 'ההרשמה מול Meta הושלמה במלואה, אך פרטי המספר לא הגיעו למערכת. לא נוצרה כפילות ולא בוצע שינוי בחשבון.',
    reasons: ['חלון ההרשמה נסגר לפני סיום התהליך'],
    nextStep: 'להריץ את התהליך שוב ולהמתין לסגירת החלון.',
    action: SHARED.retry,
  },
  no_accounts: {
    tone: 'error',
    title: 'לא נמצא חשבון WhatsApp עסקי',
    explanation: 'חיבור וואטסאפ מחייב חשבון עסקי המנוהל דרך Meta. רוב העסקים מגיעים לשלב הזה לפני שיצרו אחד.',
    reasons: ['טרם נוצר חשבון עסקי', 'החשבון מנוהל תחת חשבון Meta אחר'],
    nextStep: 'ניתן ליצור את החשבון במהלך תהליך החיבור, ללא יציאה מהמערכת.',
    action: 'להתחיל בהגדרה',
  },
  no_phones: {
    tone: 'error',
    title: 'לא שויך מספר לחשבון העסקי',
    explanation: 'קיים חשבון עסקי, אך טרם שויך אליו מספר טלפון.',
    reasons: ['המספר טרם נוסף לחשבון'],
    nextStep: 'להוסיף מספר ולהשלים את האימות. חשוב לדעת: מספר הפעיל באפליקציית WhatsApp הרגילה אינו נתמך.',
    action: 'להמשיך בהגדרה',
  },
  not_ready: {
    tone: 'attention',
    // No success/operational language — setup is not yet complete.
    title: 'הגדרת מספר ה-WhatsApp עדיין לא הושלמה',
    explanation: 'עד להשלמת ההגדרה, SocialCRM לא יכול לקבל הודעות ולידים דרך החיבור הזה.',
    reasons: ['המספר טרם אומת', 'מוגדר קוד אימות דו-שלבי'],
    nextStep: 'להשלים את האימות ב-WhatsApp Manager. אם מוגדר קוד דו-שלבי, יש להשביתו זמנית.',
    action: 'מעבר ל-WhatsApp Manager',
    secondary: 'בדיקה חוזרת',
  },
  // The subscription needed to RECEIVE messages/leads did not complete, so no
  // active connection was saved. Never presented as connected.
  subscribe_incomplete: {
    tone: 'error',
    title: 'החיבור ל-WhatsApp עדיין לא הושלם',
    explanation: 'לא הצלחנו להשלים את החיבור הדרוש כדי שהודעות ולידים יגיעו ל-SocialCRM. לא נשמר חיבור פעיל.',
    reasons: ['ייתכן שלמספר שנבחר חסרות ההרשאות הנדרשות', 'ייתכן שתהליך ההגדרה לא הושלם עד הסוף'],
    nextStep: 'כדאי להריץ את ההגדרה שוב ולהשלים את כל השלבים עד סגירת החלון.',
    action: 'להריץ את ההגדרה שוב',
  },
  // A saved connection we cannot yet PROVE is operational (legacy row without
  // verifiable subscription). We do not claim leads are arriving.
  needs_verification: {
    tone: 'attention',
    title: 'צריך לאמת את חיבור ה-WhatsApp',
    explanation: 'החיבור קיים, אבל עדיין לא הצלחנו לוודא שהודעות ולידים נכנסים אליו. עד לאימות, ייתכן שהודעות לא יגיעו.',
    nextStep: 'כדאי לחבר מחדש כדי לוודא שהחיבור פעיל.',
    action: 'לחבר מחדש ולאמת',
  },
  resource_claimed: {
    tone: 'error',
    title: 'המספר כבר מחובר לחשבון אחר',
    explanation: 'מספר ה-WhatsApp הזה כבר מחובר לחשבון SocialCRM אחר. אי אפשר לחבר אותו לשני חשבונות במקביל.',
    nextStep: 'אם המספר שייך לכם, יש לנתקו מהחשבון האחר תחילה ואז לחבר כאן.',
  },
  // Live connection: WhatsApp blocked outbound (account taxonomy). Never green.
  // Reconnect is not the default — Embedded Signup does not lift a Meta restriction.
  restricted: {
    tone: 'error',
    title: 'לא ניתן לשלוח הודעות כרגע',
    explanation: 'WhatsApp לא מאפשרת כרגע לשלוח הודעות מהחשבון המחובר.',
    nextStep: 'בדוק את חשבון WhatsApp המחובר ל-SocialCRM.',
  },
  // Live connection token died (401 / Graph 190). Distinct from ES `token`.
  expired: {
    tone: 'error',
    title: 'החיבור לוואטסאפ פג',
    explanation: 'הודעות ולידים חדשים אינם נכנסים כרגע. כל המידע הקיים במערכת נשמר במלואו.',
    reasons: ['חלף זמן מהחיבור', 'ההרשאה ב-WhatsApp שונתה'],
    nextStep: 'חידוש החיבור אורך פחות מדקה ואינו משפיע על נתונים קיימים.',
    action: SHARED.reconnect,
  },
  // Saved row, subscribed_apps empty, no inbound for this phone.
  webhook: {
    tone: 'attention',
    title: 'החיבור ל-WhatsApp עדיין לא הושלם',
    explanation: 'לא הצלחנו לוודא שהודעות ולידים מגיעים ל-SocialCRM.',
    nextStep: 'כדאי להריץ את ההגדרה שוב ולהשלים את כל השלבים עד סגירת החלון.',
    action: 'להריץ את ההגדרה שוב',
  },
}

/**
 * Codes that stay deliberately silent. Closing the signup window is a conscious
 * act and needs no explanation — the button simply remains available. `denied`
 * on the (currently unreachable) WhatsApp OAuth path is the same event.
 */
const SILENT_WHATSAPP_CODES = new Set(['cancelled', 'denied'])

/**
 * Resolve a Facebook notice. Callers that know the exact failure pass its code;
 * an unrecognised code falls back to the neutral "interrupted" message rather
 * than the save failure, which would wrongly blame our system for what is
 * usually an OAuth problem.
 */
export function facebookNotice(code: string | null | undefined): ConnectionNotice | null {
  if (!code) return null
  return FACEBOOK_NOTICES[code] ?? FACEBOOK_NOTICES.token
}

/** Resolve a WhatsApp notice. Silent codes return null by design. */
export function whatsappNotice(code: string | null | undefined): ConnectionNotice | null {
  if (!code) return null
  if (SILENT_WHATSAPP_CODES.has(code)) return null
  return WHATSAPP_NOTICES[code] ?? WHATSAPP_NOTICES.token
}
