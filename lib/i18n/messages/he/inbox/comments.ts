/**
 * COMMENTS inbox chrome (`/inbox/comments`, desktop): page, route states, the
 * status filter, the comment card (badges, body, post context, thread), the
 * reply form, convert-to-lead and "load more". Hebrew copied verbatim.
 *
 * Never here: comment text, post text, commenter and Page names, pictures.
 * "SocialCRM" is a product name, kept as written.
 */
export const comments = {
  page: {
    title: 'תגובות מפייסבוק',
    granted: 'ההרשאה אושרה. אפשר להשיב לתגובות מכאן.',
    loading: 'טוען תגובות',
  },
  error: {
    title: 'לא ניתן לטעון את התגובות',
    body: 'משהו השתבש בטעינת התגובות מפייסבוק. אפשר לנסות שוב, או לחזור לשיחות.',
  },
  empty: {
    notEnabled: {
      title: 'תגובות בפייסבוק',
      body: 'תגובות יופיעו כאן אוטומטית אחרי שתגובות פייסבוק יופעלו והדף מחובר.',
    },
    notConnected: {
      title: 'דף הפייסבוק אינו מחובר',
      body: 'כדי לראות תגובות מהדף, צריך לחבר אותו קודם בהגדרות.',
      action: 'חבר את דף הפייסבוק',
    },
    noComments: {
      title: 'אין עדיין תגובות',
      body: 'תגובות חדשות על פוסטים בדף יופיעו כאן אוטומטית.',
    },
    noOpen: {
      title: 'אין תגובות פתוחות',
      body: 'תגובות חדשות על פוסטים בדף יופיעו כאן אוטומטית. כל התגובות מופיעות תחת "הכל".',
    },
    noConverted: {
      title: 'עדיין לא נוצרו לידים מתגובות',
      body: 'כשיוצרים ליד מתגובה, היא מופיעה כאן עם קישור לליד.',
    },
  },
  filter: {
    label: 'סינון תגובות',
    all: 'הכל',
    open: 'פתוחות',
    converted: 'הומרו לליד',
  },
  list: {
    label: 'תגובות מפייסבוק',
    loadMore: 'טען עוד תגובות',
    loadingMore: 'טוען תגובות...',
    loadMoreFailed: 'לא הצלחנו לטעון עוד תגובות. נסה שוב.',
  },
  card: {
    label: 'תגובה מאת {name}',
    fallbackAuthor: 'מגיב מפייסבוק',
    channel: 'פייסבוק',
    isReply: 'תגובה לתגובה',
    /** The avatar's letter when Facebook gave no name (LeadAvatar's own default, ליד). */
    avatarFallback: 'ל',
    reply: 'ענה לתגובה',
    badge: {
      converted: 'הומר לליד',
      ignored: 'התעלמת',
      deleted: 'נמחקה בפייסבוק',
    },
  },
  body: {
    more: 'הצג עוד',
    less: 'הצג פחות',
    noText: 'תוכן התגובה לא התקבל מפייסבוק',
    photo: 'תמונה שצורפה לתגובה',
    photoGone: 'התמונה שצורפה לתגובה כבר לא זמינה',
    video: 'צפה בסרטון שצורף לתגובה',
  },
  post: {
    gone: 'הפוסט כבר לא זמין בפייסבוק',
    onPost: 'תגובה על הפוסט',
    inThread: 'תגובה בשרשור על הפוסט',
    open: 'פתח את הפוסט בפייסבוק',
  },
  thread: {
    label: 'תגובות בשרשור',
    page: 'הדף',
    yourPage: '{name} (הדף שלך)',
    sentHere: 'נשלח מ-SocialCRM',
  },
  reply: {
    label: 'תשובה בשם הדף ל־{name}',
    labelNoName: 'תשובה בשם הדף לתגובה',
    placeholder: 'כתוב תשובה בשם הדף...',
    publish: 'פרסם תשובה',
    publishing: 'מפרסם...',
    emptyHint: 'כתוב תשובה כדי לפרסם',
    cancel: 'ביטול',
    published: 'התשובה פורסמה בפייסבוק',
    thrown: 'לא הצלחנו לפרסם את התשובה. בדוק את החיבור ונסה שוב.',
    expired: 'חידוש המנוי מחזיר את ההשבה לתגובות',
    failure: {
      not_enabled: 'התכונה אינה זמינה בחשבון הזה',
      not_found: 'התגובה לא נמצאה',
      deleted: 'התגובה נמחקה בפייסבוק, ולא ניתן להשיב לה',
      page_authored: 'אי אפשר להשיב לתגובה של הדף עצמו',
      empty: 'כתוב תשובה לפני הפרסום',
      too_long: 'התשובה ארוכה מדי',
      permission_missing: 'חסרה הרשאה להשבה לתגובות. אשר את ההרשאה בראש העמוד ונסה שוב.',
      reconnect_required: 'החיבור לדף הפייסבוק פג. חבר מחדש את הדף בהגדרות ונסה שוב.',
      comment_unavailable: 'התגובה כבר לא זמינה בפייסבוק. ייתכן שנמחקה או הוסתרה.',
      rate_limited: 'פייסבוק מגביל כרגע את קצב הפעולות. נסה שוב בעוד כמה דקות.',
      blocked: 'פייסבוק חסם זמנית פרסום תגובות מהדף. כדאי לבדוק את ההתראות בדף הפייסבוק.',
      meta_error: 'פייסבוק לא אישר את פרסום התשובה. נסה שוב.',
    },
  },
  convert: {
    action: 'המר לליד',
    converting: 'ממיר לליד...',
    open: 'פתח ליד',
    created: 'הליד נוצר בהצלחה',
    existing: 'התגובה כבר מקושרת לליד קיים',
    createdToast: 'הליד נוצר בהצלחה · פתח ליד',
    existingToast: 'התגובה כבר מקושרת לליד קיים · פתח ליד',
    thrown: 'לא הצלחנו להשלים את יצירת הליד. בדוק את החיבור ונסה שוב.',
    expired: 'חידוש המנוי מחזיר את המרת התגובות לליד',
    failure: {
      not_found: 'התגובה לא נמצאה. רענן את הדף ונסה שוב.',
      deleted: 'התגובה נמחקה בפייסבוק, ולכן לא ניתן ליצור ממנה ליד.',
      page_authored: 'זו תגובה של הדף שלך, ולכן לא ניתן ליצור ממנה ליד.',
      not_enabled: 'יצירת לידים מתגובות אינה זמינה בחשבון הזה.',
      quota_exceeded: 'הגעת למכסת הלידים בחבילה הנוכחית. שדרג את החבילה כדי ליצור ליד מהתגובה.',
      create_failed: 'הליד לא נוצר. נסה שוב.',
      db_error: 'לא הצלחנו להשלים את יצירת הליד. נסה שוב.',
    },
  },
}
