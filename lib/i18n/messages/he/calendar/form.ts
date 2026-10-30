/**
 * The new-meeting and edit-meeting dialogs, the post-create summary and the
 * attendee chips input (Phase E1). Hebrew copied verbatim. `{email}` and
 * `{zone}` are data (an attendee address, the browser's IANA zone).
 */
export const form = {
  newTitle: 'פגישה חדשה',
  editTitle: 'עריכת פגישה',
  titleLabel: 'כותרת',
  titlePlaceholder: 'לדוגמה: שיחת תיאום',
  start: 'התחלה',
  end: 'סיום',
  lead: 'ליד',
  leadInfo: 'הפגישה תקושר לליד הזה',
  /** The lead picker's trigger before a lead is chosen (the picker's own default, passed in). */
  leadPlaceholder: 'בחר לקוח/ה',
  leadFallback: 'ליד #{id}',
  noLead: 'לא נבחר ליד — אוטומציות פגישה (כמו תזכורת לפני הפגישה) לא יפעלו עבור הפגישה הזו.',
  attendees: 'משתתפים',
  attendeesPlaceholder: 'הוסף אימייל ולחץ Enter',
  googleInvites: 'Google תשלח הזמנות וקישור Google Meet אוטומטית לכל המשתתפים.',
  editNotice: 'שינויים בכותרת או בזמן יישלחו לכל המשתתפים. שינויים ברשימת המשתתפים יוסיפו או יסירו אנשים מהפגישה.',
  timezone: 'אזור זמן: {zone}',
  cancel: 'ביטול',
  creating: 'יוצר…',
  create: 'צור פגישה',
  saving: 'שומר…',
  save: 'שמור שינויים',
  error: 'שגיאה',
  close: 'סגור',
  unexpected: 'אירעה שגיאה. נסה שוב.',
  invalid: {
    noTitle: 'יש להזין כותרת לפגישה',
    badDate: 'יש להזין תאריך ושעה תקינים',
    endBeforeStart: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה',
    pastCreate: 'לא ניתן ליצור פגישה בתאריך שעבר',
    pastEdit: 'לא ניתן להעביר פגישה לתאריך שעבר',
  },
  /** `createMeeting` refusals by reason code. */
  createError: {
    invalid_input: 'הקלט אינו תקין. בדוק את השדות.',
    lead_not_found: 'הליד לא נמצא.',
    not_found: 'הפגישה לא נמצאה.',
    not_owner: 'אינך מורשה לפעולה זו.',
    already_synced: 'הפגישה כבר סונכרנה.',
    generic: 'יצירת הפגישה נכשלה',
  },
  /** Edit: load and update outcomes. */
  edit: {
    notFound: 'הפגישה לא נמצאה',
    notOwner: 'אינך מורשה לערוך פגישה זו',
    loadFailed: 'טעינת הפגישה נכשלה',
    noChanges: 'לא בוצעו שינויים',
    tooShort: 'משך הפגישה חייב להיות לפחות 5 דקות',
    cancelled: 'לא ניתן לערוך פגישה מבוטלת',
    failed: 'עדכון הפגישה נכשל',
    synced: 'הפגישה עודכנה וסונכרנה ליומן Google',
    notSynced: 'הפגישה עודכנה ב-CRM (לא מסונכרנת ליומן Google)',
    reauth: 'הפגישה עודכנה ב-CRM. נדרש חיבור מחדש ליומן Google.',
    syncFailed: 'הפגישה עודכנה ב-CRM. סנכרון ליומן Google נכשל.',
    conflict: 'הפגישה עודכנה ב-CRM. סנכרון ליומן Google נכשל (נדרש רענון).',
  },
  chips: {
    invalidOne: 'כתובת לא תקינה: {email}',
    invalidMany: { other: '{count} כתובות לא תקינות הושמטו' },
    remove: 'הסר {email}',
  },
} as const

/** The confirmation shown after a meeting is created. */
export const success = {
  created: 'הפגישה נוצרה',
  saved: 'הפגישה נשמרה',
  invitesSent: 'הזמנות וקישור Google Meet נשלחו',
  synced: 'הפגישה סונכרנה ליומן Google',
  reauth: 'נדרש חיבור מחדש ליומן לסנכרון ההזמנות',
  failed: 'הסנכרון ליומן Google נכשל — ניתן לנסות שוב מתוך הפגישה ביומן',
  title: 'כותרת',
  time: 'זמן',
  attendees: 'משתתפים',
  attendeeCount: { one: '{count} משתתף', other: '{count} משתתפים' },
  attendeeCountInvited: { one: '{count} משתתף · Google שלחה הזמנה', other: '{count} משתתפים · Google שלחה הזמנה' },
  syncStatus: 'סטטוס סנכרון',
  openMeet: 'פתח Google Meet',
  close: 'סגור',
} as const
