/**
 * Admin settings — the campaign editor (`/settings/edit_promotions`, Phase
 * E5a) and the task templates (`/settings/edit_tmplts`). Copied byte-for-byte
 * from `components/promo/{PromoCards,AddPromoForm,DeletePromoBtn}`,
 * `components/cmsnRules/SelectPrdctOpts` and `components/taskTmplts/*`.
 */
export const promos = {
  newPromo: 'מבצע חדש',
  empty: 'אין מבצעים עדיין',
  edit: 'עריכת קמפיין',
  delete: 'מחיקת קמפיין',
  deleted: 'המבצע נמחק',
  deleteConfirm: 'בטוח למחוק את המבצע?',
  form: {
    add: 'הוספת קמפיין',
    name: 'שם הקמפיין',
    forManager: 'קמפיין למנהל',
    searchTeams: 'חיפוש צוותים',
    teams: 'צוותים',
    searchReps: 'חיפוש נציגים',
    reps: 'נציגים',
    desc: 'תיאור הקמפיין',
    addConds: 'הוספת תנאים',
    cond: 'תנאי {n}',
    removeCond: 'הסרת תנאי {n}',
    uploadImg: 'העלאת תמונת מבצע',
    uploadRules: 'העלאת תקנון',
    save: 'שמור קמפיין',
    noTargets: 'יש לבחור צוותים או נציגים',
    goalPrize: 'יעד ופרס {n}',
    goal: 'יעד {n}',
    prize: 'פרס יעד {n}',
  },
  product: {
    pickBranch: 'בחר ענף',
    branch: 'ענף',
    product: 'מוצר',
    pickProducts: 'בחר מוצרים',
    productType: 'סוג מוצר',
    pickTypes: 'בחר סוג מוצרים',
    company: 'חברה',
    pickCompanies: 'בחר חברות',
  },
}

export const taskTmplts = {
  empty: 'אין תבניות עדיין',
  col: { title: 'כותרת', createdAt: 'תאריך יצירה' },
  delete: 'מחק תבנית',
  deleteConfirm: 'האם למחוק את התבנית "{title}"?',
  create: 'יצירת תבנית משימה חדשה',
  save: 'שמירת שינויים',
  menu: { edit: 'עריכה', delete: 'מחק תבנית', deleteStep: 'מחיקה' },
  headerDeleteConfirm: 'האם ברצנוך למחוק את תבנית המעקב "{title}"?',
  titleLabel: 'כותרת',
  titleRequired: 'יש להזין כותרת',
  subTask: 'תת-מעקב',
  stepDeleteConfirm: 'האם למחוק את המעקב "{title}"?',
  stepTitle: 'כותרת השלב',
  duplicateTitle: 'הכותרת "{title}" כבר קיימת',
  subTaskTitle: 'כותרת תת-המעקב',
  subTaskDesc: 'תיאור',
  files: 'מסמכים קשורים',
}
