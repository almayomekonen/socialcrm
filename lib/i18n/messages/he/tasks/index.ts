/**
 * Global tasks and files pages (Phase E1, desktop): `/tasks`, `/files`. Hebrew
 * copied verbatim. "מעקב" in these tables is the legacy name of a TASK
 * (glossary D1.3 flags), never a follow-up. Sentences identical to the lead
 * tabs reuse `leadTabs.tasks.*` / `leadTabs.files.*`; only what differs lives here.
 */
export const tasks = {
  page: {
    title: 'משימות',
    description: 'כל משימות הלידים',
    actions: 'פעולות',
    reps: 'נציגים',
    filter: 'סינון',
    clearFilter: 'נקה חיפוש',
    create: 'משימה חדשה',
    empty: 'אין משימות עדיין',
    count: { other: '{count} משימות' },
    active: { other: '{count} פעילות' },
    done: { other: '{count} הושלמו' },
    overdue: { other: '{count} באיחור' },
    header: {
      title: 'מעקב',
      status: 'סטטוס',
      clientName: 'ליד',
      completed: 'הושלם',
      userName: 'נציג',
      dueDate: 'תאריך יעד',
      createdAt: 'תאריך יצירה',
      updatedAt: 'תאריך פעילות אחרון',
    },
  },
  files: {
    title: 'קבצים',
    leadFilter: 'ליד',
    empty: 'אין קבצים עדיין',
    /** The lead column; the other headers are `leadTabs.files.header.*`. */
    clientNameHeader: 'ליד',
  },
} as const
