/**
 * The issuer (business identity) step of the issue flow (Phase E3): the
 * identity dialog, its registry-driven fields labelled by field KEY, business
 * types by CODE, validation messages, and the setup-required dialog. Hebrew
 * copied verbatim from the registry (`lib/billing/issuer/fields.ts`, which is
 * unchanged). What the user types is data and is stored as typed.
 */
export const issuer = {
  dialogLabel: 'פרטי העסק',
  heading: 'לפני שמנפיקים את החשבונית הראשונה',
  intro: 'צריך להשלים כמה פרטים חד-פעמיים על העסק. זה לוקח רק כמה שניות, ויופיע על כל החשבוניות שתנפיקו.',
  submit: 'שמור והמשך',
  formHint: 'פרטים אלו יופיעו על המסמכים שתנפיקו',
  saveFailed: 'שמירת פרטי העסק נכשלה',
  field: {
    name: { label: 'שם העסק', help: 'כפי שיופיע בחשבוניות', placeholder: 'לדוגמה: רחל כהן ייעוץ' },
    businessType: { label: 'סוג העסק', help: 'לא בטוחים? תוכלו לעדכן בהמשך בהגדרות.' },
    taxId: { label: 'מספר עוסק / ח.פ', help: '8 ספרות לעצמאי, 9 ספרות לחברה. ללא מקפים.' },
    // Tier 2 — the settings business-details page (Phase E4).
    address: { label: 'כתובת', help: 'תופיע על החשבוניות. נדרשת לעוסק מורשה ולחברה.', placeholder: 'לדוגמה:\nרוטשילד 12\nתל אביב 6688112' },
    phone: { label: 'טלפון' },
    email: { label: 'אימייל לחשבוניות', help: 'משמש ככתובת המשיב כשהלקוח עונה למייל.' },
    img: { label: 'לוגו', help: 'תמונת PNG או JPG. תופיע בראש החשבונית.' },
  },
  businessType: {
    exempt: { label: 'עוסק פטור', description: 'הכנסה שנתית עד 120,000 ₪. לא גובה מע"מ.' },
    authorized: { label: 'עוסק מורשה', description: 'רוב העצמאים בישראל. גובה מע"מ.' },
    company: { label: 'חברה בע"מ', description: 'חברה רשומה ברשם החברות (ח.פ).' },
  },
  error: {
    nameRequired: 'שם העסק חובה',
    businessTypeRequired: 'יש לבחור סוג עסק',
    taxIdRequired: 'מספר עוסק / ח.פ חובה',
    taxIdInvalid: 'מספר עוסק / ח.פ לא נראה תקין',
    emailInvalid: 'כתובת אימייל לא תקינה',
  },
  setup: {
    label: 'השלמת פרטי עסק',
    heading: 'צריך להשלים קודם פרטי עסק',
    body: 'לפני הנפקת החשבונית הראשונה צריך להוסיף את פרטי העסק.',
    adminOnly: 'רק מנהל החשבון יכול לעשות את זה — אפשר לפנות אליו כדי להמשיך.',
    ok: 'הבנתי',
  },
} as const
