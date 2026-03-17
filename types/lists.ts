export const STATUS_LIST = [
  'הצעה נשלחה',
  'ממתין לפרטים',
  'תשלום ראשון התקבל',
  'ממתין להעברה',
  'ממתין למסמכים',
  'בטיפול',
  'בוצע חלקית',
  'בבדיקה',
  'הושלם',
  'שולם במלואו',
  'נגנז',
  'בוטל',
]

export const COMPANIES = ['ללא ספק', 'אחר']

export const PRDCT_TYPES = ['העברה', 'תשלום חודשי', 'תשלום חד פעמי']

export const BRANCHES = ['שירותים', 'מוצרים', 'קורסים', 'מנויים', 'חבילות', 'ייעוץ', 'אחר']

export const branchObj = {
  services: 'שירותים',
  products: 'מוצרים',
  courses: 'קורסים',
  subscriptions: 'מנויים',
  packages: 'חבילות',
  consulting: 'ייעוץ',
  other: 'אחר',
}

export const extendedBranchList = [
  'משוקלל',
  'שירותים',
  'מוצרים',
  'קורסים',
  'מנויים',
  'חבילות',
  'ייעוץ',
  'אחר',
]

const servicesList = ['ניהול סושיאל מדיה', 'בניית אתר', 'SEO', 'PPC', 'תוכן שיווקי', 'אחר']
const productsList = ['מוצר פיזי', 'מוצר דיגיטלי', 'תוכנה', 'אחר']
const coursesList = ['קורס אונליין', 'סדנה', 'ליווי אישי', 'אחר']
const subscriptionsList = ['מנוי חודשי', 'מנוי שנתי', 'אחר']
const packagesList = ['חבילה בסיסית', 'חבילה מתקדמת', 'חבילה פרמיום', 'אחר']
const consultingList = ['ייעוץ עסקי', 'ייעוץ שיווקי', 'ייעוץ אסטרטגי', 'אחר']
const otherList = ['אחר']

export const prdctOptByBranch = {
  שירותים: { prdctList: servicesList, prdctTypeList: ['תשלום חודשי', 'תשלום חד פעמי'] },
  מוצרים: { prdctList: productsList, prdctTypeList: ['תשלום חד פעמי'] },
  קורסים: { prdctList: coursesList, prdctTypeList: ['תשלום חד פעמי'] },
  מנויים: { prdctList: subscriptionsList, prdctTypeList: ['תשלום חודשי', 'תשלום חד פעמי'] },
  חבילות: { prdctList: packagesList, prdctTypeList: ['תשלום חד פעמי'] },
  ייעוץ: { prdctList: consultingList, prdctTypeList: ['תשלום חד פעמי', 'תשלום חודשי'] },
  אחר: { prdctList: otherList, prdctTypeList: ['תשלום חד פעמי'] },
  default: { prdctList: servicesList, prdctTypeList: ['תשלום חודשי', 'תשלום חד פעמי'] },
}

export const prdctOptByBranchAsignUser = {
  שירותים: { prdctList: servicesList, prdctTypeList: ['תשלום חודשי'] },
  מוצרים: { prdctList: productsList, prdctTypeList: ['תשלום חד פעמי'] },
  קורסים: { prdctList: coursesList, prdctTypeList: ['תשלום חד פעמי'] },
  מנויים: { prdctList: subscriptionsList, prdctTypeList: ['תשלום חודשי'] },
  חבילות: { prdctList: packagesList, prdctTypeList: ['תשלום חד פעמי'] },
  ייעוץ: { prdctList: consultingList, prdctTypeList: ['תשלום חד פעמי'] },
  אחר: { prdctList: otherList, prdctTypeList: ['תשלום חד פעמי'] },
  default: { prdctList: servicesList, prdctTypeList: ['תשלום חודשי'] },
}

export const optionsArray2 = Object.entries(prdctOptByBranch)
  .filter(([branch]) => branch !== 'default')
  .flatMap(([branch, { prdctList }]) => prdctList.map((prdct) => `${branch}, ${prdct}`))

export const optionsArray = Object.entries(prdctOptByBranch)
  .filter(([branch]) => branch !== 'default')
  .flatMap(([branch, { prdctList, prdctTypeList }]) =>
    prdctList.flatMap((prdct) => prdctTypeList.map((type) => `${branch}, ${prdct}, ${type}`)),
  )

export const leadSources = ['Instagram', 'Facebook', 'WhatsApp', 'אתר', 'המלצה', 'פרסום ממומן', 'אורגני']

export const familyStatusOpt = ['נשוי/ה', 'רווק/ה', 'גרוש/ה', 'אלמן/ה', 'ידועים בציבור']
export const genderOpt = ['זכר', 'נקבה']
