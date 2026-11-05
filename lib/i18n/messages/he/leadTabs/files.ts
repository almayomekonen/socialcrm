/**
 * Lead FILES tab (`/clients/[clientId]/files`): the files table, the upload
 * form and uploader chrome, and the Google Drive section with its attach
 * dialog and picker. Hebrew copied verbatim. File names are customer data;
 * "Google Drive" / "Drive" / "Picker" are product names.
 */
export const files = {
  title: 'קבצים של הליד',
  typeFilter: 'סוג קובץ',
  sizeFilter: 'גודל',
  sizeUpTo: 'עד {size}',
  upload: 'העלה קבצים',
  deleteColumn: 'מחיקה',
  /** The row's icon-only delete button (Phase E6). Named outside Hebrew only: Hebrew markup is unchanged. */
  deleteButton: 'מחיקת המסמך {name}',
  deleteConfirm: 'האם למחוק מסמך {name} ?',
  header: {
    type: 'סוג קובץ',
    name: 'שם המסמך',
    taskId: 'מעקב',
    createdAt: 'מועד יצירה',
    size: 'גודל',
    createdByName: 'הועלה ע"י',
  },
  form: {
    title: 'הוספת קבצים חדשים',
    taskLink: 'קישור למעקב (אופציונלי):',
    taskLabel: 'מעקב',
    submit: 'הוספה',
    noFiles: 'יש להעלות קבצים',
  },
  uploader: {
    title: 'העלאת קבצים',
    removeConfirm: 'להסיר את הקובץ?',
    failed: 'העלאת הקבצים נכשלה: {reason}',
    expired: 'חידוש המנוי מחזיר את העלאת הקבצים',
    /** `Glry`'s button and `FileDisplay`'s fallback for an entry without a file (Phase E6). */
    gallery: 'בחירה מגלריה',
    unavailable: 'לא ניתן להציג',
    /** `uploadToStorage`'s own refusals inside `failed` (final UI audit) — Hebrew = the exact sentences it throws (`components/files/funcs.tsx`). */
    tooLarge: 'קובץ גדול מדי',
    noneSelected: 'לא נבחרו קבצים',
  },
} as const

export const drive = {
  attach: 'צרף קובץ מ-Drive',
  expired: 'חידוש המנוי מחזיר את צירוף הקבצים',
  empty: 'אין קבצים מצורפים לליד מ-Drive.',
  suggested: 'מוצע — נמצאו ב-Drive לפי פרטי הליד',
  attached: 'הקובץ צורף לליד',
  attachedMany: { other: 'צורפו {count} קבצים' },
  attachFailed: 'הצירוף נכשל. נסה שוב.',
  detached: 'הקובץ הוסר',
  detachFailed: 'ההסרה נכשלה. נסה שוב.',
  open: 'פתח',
  detach: 'הסר',
  repick: 'צרף מחדש',
  repicked: 'הקובץ עודכן מ-Drive',
  repickFailed: 'העדכון נכשל. נסה שוב.',
  loading: 'טוען…',
  attachOne: 'צרף',
  attaching: 'מצרף…',
  dialog: {
    label: 'צירוף קובץ מ-Google Drive',
    title: 'צרף קובץ מ-Google Drive',
    intro: 'חפש בקבצים שלך ב-Drive ובחר את הקובץ לצירוף לליד.',
    searchPlaceholder: 'חפש קובץ לפי שם או תוכן…',
    minChars: 'הקלד לפחות 2 תווים',
    noResults: 'לא נמצאו קבצים',
    close: 'סגור',
  },
  picker: {
    intro: 'בחר קובץ מ-Drive לצירוף לליד.',
    pick: 'בחר קובץ מ-Drive',
    unconfigured: 'ה-Picker אינו מוגדר.',
    failed: 'פתיחת ה-Picker נכשלה. נסה שוב.',
  },
} as const
