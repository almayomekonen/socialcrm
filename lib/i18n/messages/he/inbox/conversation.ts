/**
 * Inbox CONVERSATION-level chrome (`/inbox`, desktop): the actions menu and
 * delete confirmation, the leadless-contact actions, the "who is answering"
 * line, the operator take, the conversation-intelligence card, and the
 * new-message toasts (in the thread and app-wide). Hebrew copied verbatim.
 *
 * "הסוכן" here is the AI agent (glossary D1.5: "AI agent"), never a person.
 * AI-written text (summaries, reasons, takes, handoff answers) is data.
 */
export const menu = {
  label: 'פעולות שיחה',
  delete: 'מחק שיחה',
  confirm: 'מחיקת השיחה?\n\nהשיחה וההודעות שלה יימחקו מ-SocialCRM. הפעולה לא תמחק את איש הקשר או את הליד ב-CRM.',
  cancel: 'בטל',
  deleteFailed: 'מחיקת השיחה נכשלה. נסה שוב.',
  deleted: 'השיחה נמחקה',
}

export const leadless = {
  create: '+ צור ליד',
  link: 'קשר לליד קיים',
  personal: 'סמן כאישי',
  quota: 'הגעת למכסת הלידים',
  createFailed: 'לא הצלחנו ליצור ליד',
  notFound: 'השיחה לא נמצאה',
  noMatch: 'אין ליד עם אותו מספר. אפשר ליצור ליד חדש.',
  linkFailed: 'לא הצלחנו לקשר לליד',
  personalFailed: 'לא הצלחנו לסמן כאישי',
  locked: 'חידוש המנוי מחזיר את ניהול השיחה',
}

export const ownership = {
  paused: 'המענה האוטומטי מושהה: התוכנית הנוכחית לא כוללת מענה AI, ולכן הלקוח לא קיבל תשובה אוטומטית.',
  pausedLink: 'לפרטים בהגדרות המענה האוטומטי',
  handedOff: 'הפנייה הועברה אליכם. המשך הטיפול בידי הצוות.',
  humanQuestionnaire: 'אתם עונים בשיחה הזו. השאלון לא ישלח הודעות נוספות.',
  human: 'אתם עונים בשיחה הזו. הסוכן לא ישלח הודעות עד שתחזירו לו אותה.',
  questionnaire: 'שאלון אוטומטי עונה בשיחה הזו.',
  agent: 'הסוכן עונה בשיחה הזו.',
  awaitingRep: 'ממתין לטיפול נציג',
  urgency: 'דחיפות: {value}',
  field: {
    name: 'שם',
    businessType: 'סוג העסק',
    need: 'הפנייה',
    urgency: 'דחיפות',
  },
  updating: 'מעדכן…',
  returnQuestionnaire: 'החזרת המענה לשאלון',
  returnAgent: 'החזרת המענה לסוכן',
  takeOver: 'אני עונה מכאן',
  error: {
    opted_out: 'הלקוח ביקש לא לקבל הודעות, ולכן המענה האוטומטי לא יחזור לשיחה הזו.',
    closed: 'השיחה הסתיימה. המענה האוטומטי לא יחזור אליה.',
    forbidden: 'אין לך הרשאה לשנות את זה.',
    failed: 'לא הצלחנו לעדכן. נסו שוב.',
  },
}

export const take = {
  hide: 'הסתר',
}

export const analysis = {
  title: 'ניתוח שיחה',
  pending: 'מנתח את השיחה…',
  failed: 'ניתוח השיחה נכשל. ננסה שוב אוטומטית כשתתקבל הודעה חדשה.',
  noSummary: 'אין סיכום זמין.',
  nextAction: 'הצעד הבא המומלץ: {action}',
  staleNote: 'הודעות חדשות התקבלו — הניתוח מתעדכן',
  analyzedAt: 'נותח לאחרונה {date}',
  state: {
    fresh: 'מעודכן',
    stale: 'מתעדכן',
    failed: 'נכשל',
    pending: 'בתהליך',
  },
}

/** App-wide arrivals (shown off the inbox); the name is the contact's, as stored. */
export const awareness = {
  one: 'הודעה חדשה מ{name}',
  many: { other: '{count} הודעות חדשות' },
}
