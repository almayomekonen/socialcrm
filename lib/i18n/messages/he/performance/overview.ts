/** /sum_sales (performance): sub-nav, tab titles, overview boxes and pies, goals, the report tables. Hebrew verbatim. */
export const page = {
  title: 'ביצועים',
  description: 'ביצועי עסקאות',
  monthsTitle: 'סיכום עסקאות לפי חודשים',
  monthsDescription: 'סיכום עסקאות של נציגים לפי חודשים',
  companiesTitle: 'סיכום עסקאות לפי ספקים',
  companiesDescription: 'סיכום עסקאות של נציגים לפי ספקים',
  agentsDenied: 'not allowed',
  teamsDenied: 'אין לך הרשאות לצפייה בסיכום צוותים',
} as const

export const nav = { summary: 'סיכום', reps: 'נציגים', months: 'חודשים', ads: 'מודעות' } as const

export const overview = {
  revenuePaid: 'סך הכנסות (שולם)',
  closedDeals: 'עסקאות שנסגרו',
  pipeline: 'פייפליין',
  inProgress: 'עסקאות בתהליך',
  compare: 'השוואת עסקאות',
  /** Pie names are also the keys `hideForPies` reads — only their text is translated. */
  pieCommission: 'עמלה',
  pieIncome: 'הכנסה',
  pieDeals: 'עסקאות',
  total: 'סה"כ',
  annualPace: 'קצב שנתי',
  goals: {
    categories: 'קטגוריות',
    monthDeals: 'עסקאות החודש',
    monthlyGoal: 'יעד חודשי',
    progress: 'הגעה ליעד',
    annualPace: 'קצב שנתי',
  },
} as const

/** Report tables (`GeneralTable`): headers by the SQL response KEY (the key itself is what Hebrew shows). */
export const report = {
  empty: 'אין נתונים להצגה',
  column: { rep: 'נציג', month: 'חודש', team: 'צוות', company: 'חברה' },
} as const
