/**
 * The invoice editors' CHROME (Phase E3): the new-invoice editor
 * (`/clients/[clientId]/billing/new`) and the draft editor
 * (`/clients/[clientId]/billing/[invoiceId]` while a draft). Hebrew copied
 * verbatim. Line titles / descriptions, names, the customer note and amounts
 * are data; the issued document itself follows the BILLING locale, never these.
 */
export const editor = {
  header: {
    title: { invoice: 'חשבונית חדשה', invoice_receipt: 'חשבונית/קבלה חדשה' },
    subtitle: 'מסמך חיוב חדש',
    subtitleFor: 'עבור',
    noAutosave: 'טיוטה · אין שמירה אוטומטית',
  },
  recipient: {
    heading: 'לכבוד',
    createLead: 'יצירת לקוח/ה',
    taxId: 'ע.מ / ח.פ: {taxId}',
    fallback: 'פרטי החיוב יוגדרו בעת השמירה, על בסיס שם הליד:',
    noName: 'ללא שם',
  },
  lines: {
    heading: 'פריטים',
    keyboardHint: 'טאב למעבר בין שדות · Enter לשמירה',
    firstLineHint: 'התחילו בהקלדת שם פריט בשורת ה"+ פריט חדש" למעלה',
    header: { description: 'תיאור', quantity: 'כמות', unitPrice: 'מחיר יחידה', discount: 'הנחה', lineTotal: 'סה"כ שורה' },
    newLine: '+ פריט חדש',
    titlePlaceholder: 'שם הפריט',
    descriptionPlaceholder: 'תיאור (אופציונלי)',
    deleteConfirm: 'מחק פריט',
    deleteMsg: 'למחוק את הפריט "{title}"?',
  },
  meta: {
    toggle: 'אפשרויות נוספות',
    dueAt: 'תאריך פירעון',
    customerFooter: 'הערה ללקוח (תופיע על המסמך)',
    internalNotes: 'הערות פנימיות (לא יופיעו על המסמך)',
    save: 'שמור שינויים',
  },
  totals: { heading: 'סיכום', subtotal: 'סכום ביניים', tax: 'מע"מ', total: 'סה"כ לתשלום' },
  payment: {
    heading: 'פרטי תשלום שהתקבל',
    total: 'סה"כ {amount}',
    method: 'אמצעי תשלום',
    methodPlaceholder: 'בחרו',
    amount: 'סכום ששולם',
    date: 'תאריך תשלום',
    partialHint: 'הסכום שהתקבל נמוך מסך החשבונית — המסמך ייווצר כתשלום חלקי.',
  },
  bar: {
    addLineHint: 'הוסיפו לפחות פריט אחד',
    saveDraft: 'שמור טיוטה',
    issue: 'הנפק חשבונית',
    deleteDraft: 'מחק טיוטה',
  },
  blocker: {
    noLinesToSave: 'יש להוסיף לפחות פריט אחד לפני שמירה',
    no_permission: 'אין הרשאה להנפיק',
    no_lines: 'יש להוסיף לפחות פריט אחד',
    zero_total: 'סכום החשבונית חייב להיות גדול מאפס',
    payment_incomplete: 'יש למלא את פרטי התשלום שהתקבל',
  },
  issueConfirm: 'החשבונית תקבל מספר ותיסגר לעריכה.\nאם צריך לתקן משהו בהמשך, אפשר לבטל ולהנפיק חשבונית חדשה.',
  newLead: 'ליד חדש',
  issueExpired: 'חידוש המנוי מחזיר את הפקת החשבוניות',
  newExpired: 'חידוש המנוי מחזיר את יצירת החשבוניות.',
  draft: {
    editable: 'טיוטה ניתנת לעריכה עד ההנפקה',
    noProfile: 'חסרים פרטי חיוב — אין אפשרות להנפיק',
    currency: 'מטבע: {currency}',
    deleteMsg: 'למחוק את הטיוטה? פעולה זו אינה הפיכה.',
  },
  toast: {
    draftSaved: 'הטיוטה נשמרה',
    draftSaveFailed: 'שמירת הטיוטה נכשלה',
    issued: 'החשבונית הונפקה',
    issueFailed: 'הנפקת החשבונית נכשלה',
    lineAdded: 'הפריט נוסף',
    lineAddFailed: 'הוספת הפריט נכשלה',
    lineUpdated: 'הפריט עודכן',
    lineUpdateFailed: 'עדכון הפריט נכשל',
    lineRemoved: 'הפריט נמחק',
    lineRemoveFailed: 'מחיקת הפריט נכשלה',
    metaSaved: 'השינויים נשמרו',
    metaSaveFailed: 'שמירת השינויים נכשלה',
    draftDeleted: 'הטיוטה נמחקה',
    draftDeleteFailed: 'מחיקת הטיוטה נכשלה',
    paymentSaveFailed: 'שמירת פרטי התשלום נכשלה',
  },
} as const
