/**
 * Lead TASKS tab (`/clients/[clientId]/tasks` + task detail). Hebrew copied
 * verbatim. "מעקב" here is the legacy name of a TASK (glossary D1.3 flags), not
 * a follow-up. `status.*` labels the STORED Hebrew values of `tasks.status`,
 * keyed by value in `lib/tasks/taskStatus.ts`; the stored values never change.
 */
export const tasks = {
  status: {
    new: 'חדש',
    inProgress: 'בטיפול',
    awaitingReply: 'ממתין לתשובה',
    reassigned: 'הועבר לנציג אחר',
    notRelevant: 'לא רלוונטי',
    notInterested: 'לא מעוניין',
    closed: 'סגורה',
    handled: 'הסתיים טיפול',
  },
  table: {
    statusFilter: 'סטטוס',
    handlerFilter: 'גורם מטפל',
    create: 'צור משימה חדשה',
    header: {
      title: 'כותרת',
      status: 'סטטוס',
      userName: 'גורם מטפל',
      completed: 'הושלם',
      dueDate: 'תאריך יעד',
      createdAt: 'תאריך יצירה',
      updatedAt: 'תאריך פעילות אחרון',
    },
  },
  form: {
    title: 'יצירת משימה חדשה',
    leadLabel: 'ליד',
    leadPlaceholder: 'בחירת ליד',
    taskTitleLabel: 'כותרת המעקב',
    taskTitlePlaceholder: 'לדוגמה: מעקב אחר הצעת מחיר',
    create: 'יצירת משימה חדשה',
    templateLabel: 'או בחר מתבנית',
    createFromTemplate: 'יצירת משימה מתבנית',
    titleRequired: 'יש להזין כותרת למעקב',
    leadRequired: 'יש לבחור ליד',
  },
  detail: {
    markDone: 'סמן כבוצע',
    unmarkDone: 'בטל סימון',
    repPlaceholder: 'נציג',
    statusPlaceholder: 'סטטוס',
    titleLabel: 'כותרת',
    titleRequired: 'יש להזין כותרת',
    edit: 'עריכה',
    delete: 'מחיקה',
  },
  notes: {
    title: 'הערות',
    placeholder: 'הוסף עדכון מה קרה עם הליד?',
    required: 'יש להזין תוכן להערה',
    add: 'הוסף עדכון',
    deleteNote: 'מחיקת הערה',
  },
} as const
