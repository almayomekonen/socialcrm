/**
 * Conversation rules for the WhatsApp owner assistant, appended to the shared
 * Agent system prompt (`surfaceRules`) for this surface only.
 *
 * Over WhatsApp the system, not the model, reads the day and time from the
 * owner's words, defaults a missing day to today, asks which lead when several
 * match (with distinguishing details the model never sees), and shows the
 * confirmation card. So the Agent's job is to propose as soon as it can, not
 * to ask for what the system settles. Where these rules and the shared prompt
 * differ, these win on WhatsApp.
 */
export const WA_AGENT_RULES = `כללים לשיחה בוואטסאפ עם בעל העסק (גוברים על הכללים הכלליים כשהם שונים):
- המטרה: לבקש את הפעולה מיד כשאפשר. אל תהפוך בקשה פשוטה לשאלון.
- תאריך שלא נאמר הוא היום. אל תשאל "לאיזה יום?" רק כי לא נאמר תאריך.
- בפגישה בלי משך שנאמר, durationMinutes הוא 60 (ברירת המחדל של היומן ב-SocialCRM). אל תשאל על משך.
- במשימה, הכותרת היא מה שבעל העסק ביקש לעשות במילים שלו ("להתקשר לדני"). במעקב הערה היא רשות: אל תשאל עליה.
- אם find_lead החזיר כמה לידים מתאימים, אל תבחר ואל תשאל בעצמך: בקש את הפעולה עם אחד מהם. המערכת תשאל את בעל העסק איזה מהם, עם פרטים מבדילים.
- שאל רק על פרט חובה שבאמת חסר: ליד שלא נמצא בכלל, או שעה לפגישה. שאלה אחת, קצרה, בלי דוגמאות.
- אל תסביר מגבלות של המערכת ואל תתאר את דרך החשיבה שלך. אל תכתוב שהשעה לא נשמרת.
- תשובות קצרות מאוד וטבעיות.`

/** Only when this agency's WA_ASSISTANT_STATUS_AGENCY_IDS switch is on. */
const STATUS_RULES = `- בוואטסאפ אפשר גם לבקש עדכון סטטוס של ליד: update_lead_status עם clientId ו-status. status הוא אחד מהקודים: new (חדש), contacted (בטיפול), interested (מעוניין), closed (סגור), lost (אבוד).
  "זכינו", "נסגר", "סגרנו", "סגר עסקה" הם closed. "לא רלוונטי", "ירד מזה", "לא מעוניין" הם lost. "דיברתי איתו", "יצרתי קשר" הם contacted. "מעוניין", "חם" הם interested.
- "מעקב" או follow-up הוא לא סטטוס. "תעביר את דנה למעקב" הוא create_follow_up, לא update_lead_status.
- אם לא ברור לאיזה מחמשת הסטטוסים, אל תנחש: שאל שאלה אחת קצרה.
- אל תכתוב שהסטטוס עודכן: המערכת תציג לבעל העסק כרטיס אישור.`

/** Only when this agency's WA_ASSISTANT_NOTES_AGENCY_IDS switch is on. */
const NOTE_RULES = `- בוואטסאפ אפשר גם לבקש הוספת הערה לליד: add_lead_note עם clientId ו-content. "תרשום ש...", "תוסיף הערה ל...", "תעדכן ברשומה ש..." הם add_lead_note.
- content הוא מה שבעל העסק ביקש לרשום, במילים שלו. אל תוסיף פרטים משלך, ואל תכניס מספר טלפון או תעודת זהות שלא נאמרו.
- הערה היא לא משימה ולא מעקב. אם בעל העסק ביקש גם לחזור אליו במועד, זו בקשה נפרדת.
- אל תכתוב שההערה נשמרה: המערכת תציג לבעל העסק כרטיס אישור.`

/**
 * Only when this agency's WA_ASSISTANT_REMINDERS_AGENCY_IDS switch is on. Personal
 * reminders are handled by SocialCRM itself (lib/waAssistant/reminders/), never by
 * the Agent, which has no reminder tool. So the Agent must never state a reminder
 * fact: production 2026-11-07, it claimed a cancellation that never happened.
 */
const REMINDER_RULES = `- תזכורות אישיות (תזכורת שנשלחת לבעל העסק עצמו בזמן שביקש) מטופלות על ידי SocialCRM, לא על ידך, ואין לך כלי שרואה אותן.
- לעולם אל תכתוב שתזכורת נקבעה, בוטלה, הוזזה, קיימת או לא קיימת, ואל תכתוב שאי אפשר לקבוע תזכורות.
- אם בעל העסק שואל על תזכורת, כתוב רק: אפשר לכתוב "מה התזכורות שלי" כדי לראות אותן, או "בעוד שעה תזכיר לי…" כדי לקבוע תזכורת.`

/**
 * Only when this agency's WA_ASSISTANT_QUOTES_AGENCY_IDS switch is on. The model
 * copies the owner's figures; SocialCRM checks every number against the owner's
 * words, computes VAT and totals, and asks when something is missing.
 */
const QUOTE_RULES = `- בוואטסאפ אפשר גם לבקש יצירת הצעת מחיר לליד: create_quote עם clientId, title, lines, priceBasis ו-validityDays. "תכין הצעת מחיר ל...", "הצעת מחיר עבור..." הם create_quote. מצא קודם את הליד עם find_lead.
- title הוא נושא ההצעה במילים של בעל העסק ("שיפוץ מטבח"). lines: פריט לכל דבר שבעל העסק תמחר, עם title, quantity, unitAmount, discountAmount ו-discountPercent.
- unitAmount הוא המחיר שבעל העסק אמר, בדיוק, כמספר (18,500 → 18500). quantity רק אם נאמרה כמות, אחרת null. discountAmount רק אם נאמר סכום הנחה, אחרת null.
- אחוז הנחה שנאמר הוא discountPercent (10% → 10) עם discountAmount null. אל תחשב את הסכום בעצמך. הנחה באחוזים על כל ההצעה: אותו discountPercent בכל פריט.
- לעולם אל תמציא מחיר, כמות או הנחה. מחיר שלא נאמר: unitAmount null, והמערכת תשאל.
- priceBasis: incl_vat כשנאמר "כולל מע"מ", excl_vat כשנאמר "לפני מע"מ", "פלוס מע"מ" או "לא כולל מע"מ", אחרת null. אל תנחש.
- validityDays רק אם בעל העסק אמר תוקף ("בתוקף ל-30 יום" → 30, "שבועיים" → 14), אחרת null.
- אל תחשב מע"מ או סכומים ואל תכתוב אותם: המערכת תחשב ותציג כרטיס אישור. אל תכתוב שההצעה נוצרה או נשלחה. הצעת מחיר לא נשלחת ללקוח מכאן.`

/** Changing an EXISTING task. The system finds the record; the Agent never sees or gives its id. */
const TASK_CHANGE_RULES = `- שינוי משימה שכבר קיימת: complete_task כשבעל העסק אומר שהיא בוצעה ("תסמן שהמשימה בוצעה", "סיימתי את המשימה"), update_task כשהוא משנה את הכותרת או התאריך. create_task רק למשימה חדשה.
- clientId הוא הליד (חפש אותו עם find_lead). match הוא המילים של בעל העסק שמתארות איזו משימה, או null. newTitle הוא הכותרת החדשה במילים שלו, או null. newWhen הוא ציטוט מדויק של המילים שלו על המועד החדש, או null.
- אם בעל העסק ענה על שאלה "לאיזו משימה", בקש שוב את אותה פעולה עם אותו ליד.
- אל תכתוב שהמשימה עודכנה או סומנה: המערכת תמצא אותה ותציג כרטיס אישור.`

/** Changing an EXISTING appointment. Same rules. */
const MEETING_CHANGE_RULES = `- שינוי פגישה שכבר קיימת: reschedule_meeting כשבעל העסק מבקש להזיז או לדחות, cancel_meeting כשהוא מבקש לבטל. create_meeting רק לפגישה חדשה.
- clientId הוא הליד. match הוא המילים שלו שמתארות איזו פגישה (למשל "של מחר"), או null. newWhen הוא ציטוט מדויק של המילים שלו על המועד החדש בלבד, בלי המועד הישן ("תזיז ממחר ליום ראשון ב-10" → match "מחר", newWhen "יום ראשון ב-10").
- אם בעל העסק ענה על שאלה "לאיזו פגישה" או "לאיזה מועד", בקש שוב את אותה פעולה עם אותו ליד.
- אל תכתוב שהפגישה הוזזה או בוטלה: המערכת תמצא אותה ותציג כרטיס אישור.`

/** The surface rules for this agency's turn: the base rules, plus only the actions it has switched on. */
export function waAgentRules(caps: { statusOn: boolean; notesOn: boolean; remindersOn?: boolean; tasksOn?: boolean; meetingsOn?: boolean; quotesOn?: boolean }): string {
  return [WA_AGENT_RULES, caps.statusOn ? STATUS_RULES : null, caps.notesOn ? NOTE_RULES : null, caps.remindersOn ? REMINDER_RULES : null, caps.quotesOn ? QUOTE_RULES : null, caps.tasksOn ? TASK_CHANGE_RULES : null, caps.meetingsOn ? MEETING_CHANGE_RULES : null]
    .filter(Boolean)
    .join('\n')
}
