/**
 * Lead add/edit form, duplicate banner, assign / transfer forms, saved-list
 * form and the import dialog. Hebrew copied verbatim (Phase C).
 *
 * `genderOption` and `sourceOption` are DISPLAY labels for stored values: the
 * form still submits the stored Hebrew value (`types/lists.ts`) unchanged.
 */
export const form = {
  addTitle: 'הוספת ליד',
  editTitle: 'עריכת ליד',
  owner: 'בעל הליד',
  firstName: 'שם פרטי',
  lastName: 'שם משפחה',
  gender: 'מין',
  phone: 'טלפון נייד',
  email: 'מייל',
  birthDate: 'תאריך לידה',
  leadSource: 'מקור הליד',
  handler: 'אחראי נוסף (לא חובה)',
  status: 'סטטוס',
  kindLead: 'ליד',
  moreInfo: 'מידע נוסף',
  idNum: "מס' תעודת זהות",
  secPhone: 'טלפון נוסף',
  idNumTaken: 'תעודת זהות זו משוייכת לליד {name}',
  idNumInvalid: 'תעודת זהות לא תקינה',
  genderOption: { male: 'זכר', female: 'נקבה' },
  sourceOption: {
    manual: 'ידני',
    website: 'אתר',
    referral: 'המלצה',
    import: 'ייבוא',
    misc: 'אחר',
  },
} as const

export const duplicate = {
  strong: 'ייתכן שהליד הזה כבר קיים במערכת',
  soft: 'נמצא ליד דומה במערכת',
  hide: 'הסתר',
  unnamed: 'ליד ללא שם',
  hint: 'אם זה אותו ליד, אפשר לבטל ולעדכן את הליד הקיים. אחרת, אפשר להמשיך ולשמור.',
  signal: { idNum: 'תעודת זהות זהה', phone: 'מספר טלפון זהה', email: 'כתובת מייל זהה' },
} as const

export const assign = {
  titleMany: { other: 'שיוך {count} לידים לנציג' },
  pickRep: 'בחר נציג',
  submit: 'שייך לנציג',
  cancel: 'ביטול',
  confirmOne: 'לשייך את הליד ל{rep}?',
  confirmMany: { other: 'לשייך {count} לידים ל{rep}?' },
} as const

export const transfer = {
  title: 'העברת ליד מבעל הליד {owner}',
  pickOwner: 'בחר בעל ליד חדש',
  confirm: 'האם להעביר ליד {name} לבעל ליד {owner} ?',
} as const

export const list = {
  editTitle: 'עריכת רשימה',
  newTitle: 'יצירת רשימה חדשה',
  delete: 'מחיקת רשימה',
  name: 'שם הרשימה',
  search: 'חיפוש',
  pickLeads: 'בחר לידים',
  pickRequired: 'יש לבחור לידים',
} as const

export const upload = {
  proTitle: 'ייבוא לידים זמין עם Pro',
  proBody: 'חידוש המנוי יחזיר את ייבוא הלידים מקובץ.',
  method: 'דרך הייבוא',
  fileTypes: 'קובץ Excel או CSV (xlsx, xls, csv)',
  fileHint: 'שורה ראשונה: שם פרטי, טלפון — ואפשר גם שם משפחה, מייל, תעודת זהות.',
  excelButton: 'העלאת קובץ excel',
  saved: 'לידים שנשמרו בהצלחה',
  imported: { other: 'יובאו בהצלחה {count} לידים' },
  viewYourLeads: 'צפה בלידים שלך',
  invalid: 'מידע לא תקין, לא נשמר',
  csvTitle: 'ייבוא לידים מקובץ CSV',
  csvHint: 'עמודות נדרשות: שם, טלפון, מייל (לפחות טלפון או מייל)',
  processing: 'מעבד...',
  csvButton: 'העלאת קובץ CSV',
  allExist: 'כל הלידים כבר קיימים במערכת',
  alreadyUploaded: 'נראה שהקובץ כבר הועלה בעבר',
  addedNew: { other: 'נוספו {count} לידים חדשים' },
  unchanged: { other: '{count} לידים כבר קיימים ולא שונו' },
  allAdded: 'כל הלידים נוספו בהצלחה',
  noneAdded: 'לא נוספו לידים',
  checkColumns: 'בדוק שהקובץ כולל עמודת טלפון או מייל',
  updated: { other: 'עודכנו פרטים ב-{count} לידים קיימים' },
  invalidRows: 'שורות לא תקינות: {n}',
  viewLeads: 'צפה בלידים',
} as const
