/**
 * Admin settings — users, invitations and teams (Phase E5a). Copied
 * byte-for-byte from `components/agntsAndGrps/*`, `components/invitations/*`
 * and `types/roles.ts` (`MapRoles`).
 */
export const users = {
  title: 'עריכת משתמשים',
  invitationsTitle: 'הזמנות',
  allRoles: 'כל התפקידים',
  /** `MapRoles` — the role words of the users / invitations tables and the role pickers (by role CODE). */
  role: { AGNT: 'נציג מכירות', MNGR: 'מנהל', OFFICE: 'תפעול', ADMIN: 'אדמין', GM: 'מנהל כללי', EXT: 'שותף חיצוני' },
  col: {
    name: 'שם',
    role: 'תפקיד',
    email: 'אימייל',
    phone: 'טלפון',
    suspended: 'מושעה',
    gavePerm: 'הרשאות שנתן',
    gotPerm: 'הרשאות שקיבל',
    updatedAt: 'עודכן בתאריך',
    createdAt: 'נוצר בתאריך',
    id: 'מזהה',
    edit: 'עריכה',
  },
  editRep: 'עריכת נציג',
  edit: {
    newUser: 'הוספת משתמש',
    transfer: 'העברת עסקאות לנציג אחר',
    deleteRep: 'מחיקת נציג',
    personal: 'פרטים אישיים',
    firstName: 'שם פרטי',
    lastName: 'שם משפחה',
    email: 'מייל',
    emailTitle: 'הזן כתובת דואר אלקטרוני תקינה (לדוגמה, user@example.com)',
    phone: 'מספר טלפון',
    role: 'תפקיד',
    suspended: 'חשבון מושעה',
    perms: 'הרשאות',
    reps: 'נציגים',
    save: 'שמור פרטים',
    officeRefused: 'לא ניתן להחליף את הנציג למתפעל, כיוון שיש לנציג עסקאות. העבר את העסקאות לנציג אחר ונסה שוב.',
    deleteRefused: `המשתמש {name} לא נמחק, מכיוון שיש עסקאות על שמו.
מחק את העסקאות
או העבר אותן לנציג אחר
ונסה שוב`,
    deleteLinked: 'לא ניתן למחוק את הנציג כי מקושרים אליו לידים',
    deleteConfirm: 'בטוח למחוק את {name}?',
  },
}

export const invitations = {
  col: {
    firstName: 'שם פרטי',
    lastName: 'שם משפחה',
    email: 'אימייל',
    role: 'תפקיד',
    phone: 'טלפון',
    createdAt: 'נוצר בתאריך',
    expiresAt: 'תאריך תפוגה',
    status: 'סטטוס',
    delete: 'מחיקה',
  },
  deleteLabel: 'מחיקת הזמנה',
  invite: 'הזמנת משתמש',
  deleteConfirm: 'האם למחוק את ההזמנה?',
  expired: 'פג תוקף',
  pending: 'ממתין לאישור',
  genericError: 'אירעה שגיאה, נסה שוב',
  existing: 'המשתמש כבר קיים במערכת, ולכן אין צורך בהזמנה. כדי שיהיה נציג — אפשר לשנות את התפקיד שלו בטבלת המשתמשים שמעל.',
  form: { title: 'משתמש חדש', firstName: 'שם פרטי', lastName: 'שם משפחה', email: 'אימייל', phone: 'טלפון', role: 'תפקיד', send: 'שליחת הזמנה' },
  /** `sendInvitation`'s answers (`actions/invitations.ts`, no code): worded on the client by exact sentence. */
  server: {
    forbidden: 'אין הרשאה',
    badRole: 'תפקיד לא תקין',
    sendFailed: 'שליחת ההזמנה נכשלה. נסה שוב.',
    createFailed: 'אירעה שגיאה ביצירת ההזמנה.',
  },
}

export const teams = {
  title: 'עריכת צוותים',
  add: 'הוספת צוות',
  empty: 'אין צוותים עדיין',
  edit: 'עריכת צוות',
  delete: 'מחיקת צוות',
  mngrs: 'מנהלים',
  repsCount: 'נציגים ({count})',
  offices: 'מתפעלים',
  deleteConfirm: 'בטוח למחוק את הצוות {name} ?',
  form: { name: 'שם הצוות', mngrs: 'מנהלים', reps: 'נציגים', offices: 'מתפעלים', noReps: 'יש לבחור נציגים', mngrIsRep: 'מנהל לא יכול להיות גם נציג' },
}
