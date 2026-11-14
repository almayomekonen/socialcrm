/**
 * Ready-made WhatsApp messages in Settings → Integrations (Phase E4): the
 * section notices, the list and its rows, statuses (by status CODE), rejection
 * reasons (by category), the create dialog and its validation, every action
 * result. Hebrew copied verbatim from the components, `lib/whatsapp/templates/
 * messages.ts` and the template actions (whose Hebrew results are worded here
 * by exact sentence). Template titles and bodies are business data; the
 * variable tokens inserted into a body are STORED and stay Hebrew.
 */
export const templates = {
  notConnected: { title: 'צריך לחבר וואטסאפ עסקי', explanation: 'כדי ליצור הודעות WhatsApp מוכנות, חברו קודם את מספר הוואטסאפ העסקי.' },
  notReady: { title: 'חיבור הוואטסאפ עדיין לא מוכן', explanation: 'לאחר שהחיבור יאומת, אפשר יהיה ליצור הודעות WhatsApp מוכנות.' },
  goConnect: 'למעבר לחיבור וואטסאפ',
  badge: { approved: { other: '{count} מוכנות' }, pending: { other: '{count} בבדיקה' } },
  listLabel: 'הודעות WhatsApp מוכנות',
  status: { pending: 'בבדיקת וואטסאפ', approved: 'מוכנה לשליחה', rejected: 'נדחתה', paused: 'מושהית', disabled: 'לא פעילה' },
  rejection: {
    invalid_format: 'ההודעה לא אושרה — הניסוח לא תקין. כדאי לפשט את הטקסט ולנסות שוב.',
    policy: 'ההודעה לא אושרה — התוכן נוגד את מדיניות וואטסאפ. כדאי לנסח מחדש בלי תוכן שיווקי אגרסיבי.',
    content_mismatch: 'ההודעה לא אושרה — מטרת ההודעה לא תואמת לתוכן. כדאי לבחור מטרה אחרת או לשנות את הנוסח.',
    generic: 'וואטסאפ לא אישרה את ההודעה. כדאי לנסח מחדש בפשטות ולנסות שוב.',
  },
  rejectedTitle: 'ההודעה לא אושרה',
  pending: { title: 'ההודעה נשלחה לאישור וואטסאפ', explanation: 'אין צורך לעשות דבר — ברגע שתאושר, היא תהיה מוכנה לשליחה.' },
  row: { edit: 'עריכת הודעה', retry: 'עריכה ושליחה מחדש', archive: 'ארכיון', discard: 'הסר', archiveConfirm: 'להעביר את "{title}" לארכיון?', discardConfirm: 'להסיר את "{title}"?' },
  empty: {
    title: 'אין עדיין הודעות WhatsApp מוכנות',
    body: 'הודעות WhatsApp מוכנות מאפשרות לפנות ללידים גם אחרי שהשיחה נרגעה — תזכורת, מבצע או עדכון — בלי להמתין שהליד יכתוב קודם.',
    cta: 'צור הודעה מוכנה',
    ctaHint: 'נסחו הודעה שאפשר לשלוח ללידים בכל זמן',
    autoReply: 'רוצים שהמערכת תשיב אוטומטית ללידים חדשים? זה מוגדר ב״מענה אוטומטי״.',
  },
  newMessage: 'הודעה מוכנה חדשה',
  editMessage: 'עריכת הודעה',
  submit: 'שלח לבדיקה',
  editNote: 'יצירת גרסה חדשה לבדיקה. ההודעה הנוכחית תישאר פעילה עד שהגרסה החדשה תאושר — אפשר להעביר אותה לארכיון לאחר מכן.',
  created: 'ההודעה נוצרה ונשלחה לאישור וואטסאפ',
  archived: 'ההודעה הועברה לארכיון',
  discarded: 'ההודעה הוסרה',
  form: {
    title: 'שם ההודעה',
    titlePlaceholder: 'למשל: תזכורת פולואפ',
    body: 'תוכן ההודעה',
    bodyPlaceholder: 'כתבו את ההודעה שתישלח ללידים...',
    personal: 'הוספת פרטים אישיים:',
    purpose: 'מה מטרת ההודעה?',
    utility: 'עדכון או תזכורת ללקוח',
    utilityHint: 'סטטוס, תזכורת, מענה',
    marketing: 'מבצע או הצעה שיווקית',
    marketingHint: 'קופון, מבצע, השקה',
    previewLabel: 'כך הליד יראה את ההודעה',
    previewEmpty: 'תצוגה מקדימה של ההודעה',
    cancel: 'ביטול',
  },
  variable: { leadName: 'שם הליד', businessName: 'שם העסק' },
  validation: {
    titleRequired: 'צריך לתת שם להודעה.',
    titleTooLong: 'שם ההודעה ארוך מדי.',
    bodyRequired: 'צריך לכתוב תוכן להודעה.',
    bodyTooLong: 'תוכן ההודעה ארוך מדי.',
    purposeRequired: 'צריך לבחור את מטרת ההודעה.',
    unknownVariable: 'יש פרט אישי לא מוכר בהודעה.',
    manualPlaceholder: 'אין להקליד סוגריים מסולסלים ({{ }}) בהודעה. להוספת פרטים אישיים השתמשו בכפתורי הפרטים.',
  },
  error: {
    createPerm: 'אין הרשאה ליצור הודעות WhatsApp מוכנות.',
    connect: 'צריך לחבר וואטסאפ עסקי לפני יצירת הודעות WhatsApp מוכנות.',
    invalid: 'יש למלא שם, תוכן ומטרה להודעה.',
    managePerm: 'אין הרשאה לנהל הודעות WhatsApp מוכנות.',
    notFound: 'ההודעה לא נמצאה.',
    useDiscard: 'הודעה שממתינה לבדיקה או שנדחתה — יש להסיר, לא להעביר לארכיון.',
    useArchive: 'הודעה מאושרת — אפשר להעביר לארכיון, לא להסיר.',
    notRetriable: 'לא נמצאה הודעה שנדחתה לנסות מחדש.',
    rateLimit: 'יצרתם היום את מכסת ההודעות המוכנות. נסו שוב מחר.',
    deleteFailed: 'לא ניתן להסיר את ההודעה כרגע. נסו שוב.',
  },
} as const
