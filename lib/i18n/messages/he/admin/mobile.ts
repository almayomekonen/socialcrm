/**
 * Phone admin settings (Phase F2): the users list (`UsersListMobile`), the
 * auto-response screen and its switch (`AutoResponseMobile`,
 * `AutoResponseToggle`) and the questionnaire status (`QuestionnaireMobile`).
 * Hebrew copied verbatim. User names, e-mails, phones, the fixed message and
 * the Smart Agent's business description (AI configuration) are shown as stored.
 */
export const mobile = {
  users: {
    title: 'משתמשים',
    invitations: 'הזמנות',
    noUsers: 'אין עדיין משתמשים בסביבת העבודה.',
    noInvitations: 'אין הזמנות ממתינות.',
    userFallback: 'משתמש {id}',
    invitationFallback: 'הזמנה {id}',
    user: 'משתמש',
    suspended: 'מושעה',
    active: 'פעיל',
    role: 'תפקיד',
    email: 'אימייל',
    phone: 'טלפון',
    status: 'סטטוס',
    desktopNote: 'הוספת משתמשים, שינוי תפקידים והרשאות זמינים מהמחשב.',
  },
  autoResponse: {
    channelOff: 'ערוץ הוואטסאפ כבוי, כך שגם כשהמענה האוטומטי פעיל לא נשלחות הודעות. אפשר להפעיל אותו מהמחשב.',
    questionnaire: 'הפניות בוואטסאפ נענות כרגע בשאלון קבוע שהוגדר עבורכם, ולא בהודעה שמופיעה כאן. כיבוי המענה האוטומטי עוצר גם את השאלון.',
    sent: 'ההודעה שנשלחת',
    fixedNotSet: 'עדיין לא הוגדרה הודעה קבועה.',
    smartExplain: 'כל תשובה נכתבת לפי ההודעה שהתקבלה, כך שאין נוסח קבוע להצגה.',
    advanced: 'הגדרות מתקדמות זמינות מהמחשב.',
    on: 'פעיל · עונה אוטומטית בוואטסאפ',
    off: 'כבוי · אין מענה אוטומטי',
    forbidden: 'רק מנהל יכול לשנות את המענה האוטומטי.',
    failed: 'לא הצלחנו לעדכן את המענה האוטומטי. נסו שוב.',
    proTitle: 'המענה האוטומטי זמין עם Pro',
    proBody: 'חידוש המנוי יחזיר את המענה האוטומטי.',
  },
  questionnaire: {
    draft: 'יש טיוטה פתוחה שעוד לא פורסמה.',
    desktop: 'עריכת השאלון ופרסום גרסה חדשה זמינים במחשב.',
    afterPublish: 'אחרי שיפורסם שאלון, אפשר יהיה לבדוק אותו כאן.',
  },
} as const
