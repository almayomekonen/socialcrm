/**
 * Lead summary (`/clients/[clientId]/summary`) — status card, follow-up
 * control, first-lead callout, tasks and activity, ready-message dialog.
 * Hebrew copied verbatim. Outcome labels mirror `OUTCOME_LABELS` (by code).
 */
export const summary = {
  nextFollowUp: 'מעקב הבא: {date}',
  noFollowUp: 'לא נקבע מעקב',
  lastInteraction: 'אינטראקציה אחרונה: {outcome}',
} as const

export const outcome = {
  call_no_answer: 'לא ענה',
  call_reached: 'דיברנו',
  call_interested: 'מעוניין',
  call_not_interested: 'לא מעוניין',
  meeting_completed: 'פגישה הושלמה',
  meeting_no_show: 'לא הגיע לפגישה',
} as const

export const followUp = {
  tomorrow: 'מחר',
  in3Days: 'בעוד 3 ימים',
  inWeek: 'בעוד שבוע',
  otherDate: 'תאריך אחר…',
  remove: 'הסר מעקב',
  set: 'קבע מעקב',
  current: 'מעקב: {date}',
  toastSet: 'נקבע מעקב ל־{date}',
  toastCleared: 'המעקב הוסר',
  expired: 'חידוש המנוי מחזיר את קביעת המעקבים',
} as const

export const firstLead = {
  title: 'הליד הראשון שלך בפנים',
  body: 'קבע מתי לחזור אליו, ו־SocialCRM ידאג להחזיר אותו אליך בזמן.',
  done: 'מעולה. הליד שלך בטיפול.',
  backToLeads: 'חזרה ללידים',
  dismiss: 'סגירה',
} as const

export const tasks = {
  title: 'משימות',
  all: 'לכלל המשימות',
} as const

export const activity = {
  title: 'הערות ושיחות',
  empty: 'עדיין אין הערות על הליד הזה. כתבו מה נאמר בשיחה, כדי שתוכלו להמשיך בדיוק מאותה נקודה.',
  placeholder: 'מה נאמר בשיחה? מה סוכם עם הליד?',
  add: 'הוסף הערה',
  saving: 'שומר…',
  edit: 'ערוך הערה',
  saveEdit: 'שמור שינויים',
  delete: 'מחק הערה',
  confirmDelete: 'למחוק את ההערה? לא ניתן לשחזר אותה.',
  errors: {
    empty: 'יש לכתוב תוכן להערה',
    tooLong: 'ההערה ארוכה מדי. קצרו אותה ונסו שוב.',
    notFound: 'הליד או ההערה לא נמצאו. רעננו את העמוד ונסו שוב.',
  },
} as const

export const readyMessage = {
  open: 'שלח הודעה מוכנה',
  title: 'שליחת הודעה מוכנה',
  intro: 'בחרו הודעה שאושרה — היא תישלח לליד בוואטסאפ.',
  legend: 'הודעות WhatsApp מוכנות לשליחה',
  preview: 'תצוגה מקדימה',
  previewEmpty: 'בחרו הודעה כדי לראות תצוגה מקדימה',
  sending: 'שולח…',
  send: 'שלח הודעה',
  sent: 'ההודעה נשלחה',
  proTitle: 'שליחת הודעות זמינה עם Pro',
  proBody: 'חידוש המנוי יחזיר את שליחת ההודעות ללידים.',
} as const
