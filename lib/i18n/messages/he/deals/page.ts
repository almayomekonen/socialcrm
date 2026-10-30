/** The /deals page: title, summary cards, nav, table chrome, row menu, group actions, toasts. Hebrew copied verbatim. */
export const page = {
  title: 'עסקאות',
  description: 'ניהול עסקאות ולידים',
  summary: { revenueMonth: 'הכנסות החודש', revenueTotal: 'סה"כ הכנסות', dealsTotal: 'סה"כ עסקאות' },
  formDialog: 'טופס עסקה',
} as const

export const table = {
  header: {
    offrDt: 'תאריך פנייה',
    clientData: 'לקוח',
    status: 'סטטוס',
    company: 'ספק',
    prdct: 'שירות',
    userName: 'נציג',
    amount: 'סכום עסקה',
    saleDt: 'תאריך עסקה',
    action: 'סוג',
    handlerName: 'אחראי',
    leadSource: 'מקור',
    bizName: 'שם עסק',
    notes: 'הערות',
  },
  actions: 'פעולות',
  search: 'חיפוש עסקה',
  deleteSelected: 'מחק ({count})',
  deleteAll: 'מחק הכל ({count})',
  import: 'ייבוא עסקאות',
  add: 'הוסף עסקה',
  empty: { title: 'אין עדיין עסקאות', body: 'כדי להתחיל, עבור ללידים וסגור עסקה', toLeads: 'מעבר ללידים' },
  menu: { delete: 'מחיקה', edit: 'עריכה', addFavorite: 'הוספה למועדפים' },
  confirmDelete: 'מחיקה',
  bulkConfirm: { other: 'למחוק {count} עסקאות?' },
  deleteOneConfirm: 'בטוח למחוק עסקה של {name} ?',
  skipped: { other: '{count} עסקאות לא נמחקו (ללא הרשאה או לא נמצאו)' },
  toast: {
    bulkDeleted: 'העסקאות נמחקו',
    deleted: 'העסקה נמחקה בהצלחה',
    statusUpdated: 'סטטוס עודכן בהצלחה',
    favoriteAdded: 'העסקה נוספה למועדפים',
    favoriteRemoved: 'העסקה הוסרה ממועדפים',
  },
} as const

/** The table's group-action picker (`GroupAction`). Option VALUES stay the Hebrew codes; only the text is translated. */
export const group = {
  placeholder: 'פעולות',
  statusHead: 'עדכון סטטוס',
  deleteHead: 'מחיקה',
  favoritesHead: 'מועדפים',
  delete: 'מחיקת העסקאות',
  addFavorite: 'הוספה למועדפים',
  removeFavorite: 'הסרה ממועדפים',
  confirm: {
    delete: 'בטוח למחוק את העסקאות?',
    addFavorite: 'בטוח להוסיף את העסקאות למועדפים?',
    removeFavorite: 'בטוח להסיר את העסקאות ממועדפים?',
    status: 'לשנות את סטטוס העסקאות ל{status}?',
  },
  toast: {
    deleted: 'העסקאות נמחקו בהצלחה',
    deleteFailed: 'שגיאה, העסקאות לא נמחקו',
    favoritesAdded: 'העסקאות נוספו למועדפים',
    favoritesRemoved: 'העסקאות הוסרו ממועדפים',
    statusUpdated: 'סטטוס עודכן בהצלחה',
  },
} as const
