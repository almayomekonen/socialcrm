/**
 * The /leads and /clients table: status vocabulary, column headers, cells,
 * toolbar, row menu. Hebrew copied verbatim from the components (Phase C).
 */

/** Lead status labels, by stored status CODE, as the table / tabs / badges word them. */
export const status = {
  new: 'חדש',
  contacted: 'בטיפול',
  interested: 'מעוניין',
  closed: 'סגור',
  lost: 'אבוד',
} as const

/**
 * The same codes as the lead form and the duplicate banner word them. A second
 * vocabulary already existed in the Hebrew UI; both are kept byte-for-byte.
 */
export const statusForm = {
  new: 'חדש',
  contacted: 'בטיפול',
  interested: 'מתעניין',
  closed: 'נסגר',
  lost: 'לא רלוונטי',
} as const

export const table = {
  /** Column headers by column KEY (`user.tblPref` stores its own label; display reads these). */
  header: {
    name: 'שם מלא',
    phone: 'מספר טלפון',
    status: 'סטטוס',
    nextAction: 'פעולה הבאה',
    leadSource: 'מקור',
    userName: 'בעל הליד',
    handlerName: 'אחראי נוסף (לא חובה)',
    email: 'מייל',
    idNum: 'תעודת זהות',
    secPhone: 'טלפון נוסף',
    birthDate: 'תאריך לידה',
    gender: 'מין',
    leadStatus: 'מצב ליד',
    lastContact: 'מגע אחרון',
  },
  actions: 'פעולות',
  /** A closed lead, shown as a customer (badge, and the /clients status option for `new`). */
  customer: 'לקוח',
  nextAction: {
    new: 'התקשר עכשיו',
    contacted: 'עקוב אחרי',
    interested: 'סגור עסקה',
  },
  lastContact: {
    today: 'היום',
    yesterday: 'אתמול',
    daysAgo: { other: 'לפני {count} ימים' },
  },
  statusUpdated: 'סטטוס עודכן',
} as const

export const toolbar = {
  clearSearch: 'נקה חיפוש',
  results: { one: 'תוצאה אחת', other: '{count} תוצאות' },
  assigning: 'משייך... ({n})',
  assign: 'שיוך לנציג ({n})',
  deleting: 'מוחק... ({n})',
  deleteAll: 'מחק הכל ({n})',
  delete: 'מחק ({n})',
  deleteCustomers: 'מחק לקוחות ({n})',
  sortPriority: 'מיון: דחופים ביותר',
  sortNewest: 'מיון: חדשים ביותר',
  sortAria: 'מיון לידים',
  newLead: 'ליד חדש',
  newCustomer: 'לקוח חדש',
  lists: 'רשימות',
  editList: 'ערוך רשימה',
  newList: 'רשימה חדשה',
  noRowsSelected: 'לא נבחרו רשומות מהטבלה',
} as const

/** Row menu and group actions, by action CODE (`leadActions.ts`). */
export const action = {
  open: 'פתח ליד',
  edit: 'עריכה',
  deal: 'סגור עסקה',
  dealAnother: 'הוסף עסקה נוספת',
  dealLost: 'הוסף עסקה (ליד אבוד)',
  transfer: 'העברה לבעל ליד אחר',
  delete: 'מחיקה',
} as const
