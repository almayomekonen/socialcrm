/** Table empty states and the route skeleton. Hebrew copied verbatim (Phase C). */
export const empty = {
  noMatchLeads: 'לא נמצאו לידים מתאימים',
  noMatchCustomers: 'לא נמצאו לקוחות מתאימים',
  searchNarrowsLeads: 'החיפוש הנוכחי מצמצם את הרשימה. הלידים שלך במערכת ולא אבדו.',
  searchNarrowsCustomers: 'החיפוש הנוכחי מצמצם את הרשימה. הלקוחות שלך במערכת ולא אבדו.',
  filterNarrowsLeads: 'הסינון הנוכחי מצמצם את הרשימה. הלידים שלך במערכת ולא אבדו.',
  filterNarrowsCustomers: 'הסינון הנוכחי מצמצם את הרשימה. הלקוחות שלך במערכת ולא אבדו.',
  showAllLeads: 'הצג את כל הלידים',
  showAllCustomers: 'הצג את כל הלקוחות',
  noLeadsYet: 'אין עדיין לידים',
  noCustomersYet: 'אין לקוחות עדיין',
  leadsHint: 'חבר פייסבוק או הוסף ליד ידנית',
  customersHint: 'אפשר להתחיל על ידי יצירת ליד או העלאת קובץ',
  addLead: 'הוסף ליד',
  uploadLeads: 'העלה לידים',
  tabEmpty: 'אין לידים בסטטוס זה כרגע',
  showInStatus: 'הצג לידים ב"{status}" ({n})',
  addManually: 'הוסף ליד ידנית',
  or: ' או ',
  uploadFile: 'העלה קובץ לידים',
  loading: 'טוען…',
} as const

/** Page chrome: tab titles and the /clients explanation line. */
export const page = {
  leadsTitle: 'נתוני לידים',
  leadsDescription: 'כל נתוני הלידים',
  clientsTitle: 'נתוני לקוחות',
  clientsDescription: 'כל נתוני הלקוחות',
  clientsExplainer: 'לקוחות הם לידים שסגרו עסקה',
} as const
