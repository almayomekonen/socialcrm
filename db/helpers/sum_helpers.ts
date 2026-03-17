// SocialCRM branch aggregation — one column per branch from types/lists.ts BRANCHES
export const branchesSum = `
  COALESCE(SUM(cmsn), 0)::INT AS "משוקלל",
  SUM(CASE WHEN branch = 'שירותים' THEN "tfuca" ELSE 0 END)::INT AS "שירותים",
  SUM(CASE WHEN branch = 'מוצרים'  THEN "tfuca" ELSE 0 END)::INT AS "מוצרים",
  SUM(CASE WHEN branch = 'קורסים'  THEN "tfuca" ELSE 0 END)::INT AS "קורסים",
  SUM(CASE WHEN branch = 'מנויים'  THEN "tfuca" ELSE 0 END)::INT AS "מנויים",
  SUM(CASE WHEN branch = 'חבילות'  THEN "tfuca" ELSE 0 END)::INT AS "חבילות",
  SUM(CASE WHEN branch = 'ייעוץ'   THEN "tfuca" ELSE 0 END)::INT AS "ייעוץ",
  SUM(CASE WHEN branch = 'אחר'     THEN "tfuca" ELSE 0 END)::INT AS "אחר"
`

// Same as branchesSum — kept as a named alias used in asign-user context
export const branchesSumAsignUser = branchesSum

export const sumByMonths = `
  CASE EXTRACT(MONTH FROM s."offrDt")::INT
    WHEN 1  THEN 'ינואר'
    WHEN 2  THEN 'פברואר'
    WHEN 3  THEN 'מרץ'
    WHEN 4  THEN 'אפריל'
    WHEN 5  THEN 'מאי'
    WHEN 6  THEN 'יוני'
    WHEN 7  THEN 'יולי'
    WHEN 8  THEN 'אוגוסט'
    WHEN 9  THEN 'ספטמבר'
    WHEN 10 THEN 'אוקטובר'
    WHEN 11 THEN 'נובמבר'
    WHEN 12 THEN 'דצמבר'
  END AS "חודש"
`

export const hebrewMonths = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

export interface BranchesSumType {
  משוקלל: number
  שירותים: number
  מוצרים: number
  קורסים: number
  מנויים: number
  חבילות: number
  ייעוץ: number
  אחר: number
}

export const saleStats = `
  COUNT(DISTINCT "clientId")                                                        AS "clientsWithSales",
  COUNT(*)                                                                           AS "prdctsCount",
  COUNT(CASE WHEN status IN ('הצעה נשלחה')                                    THEN 1 END) AS "inHafakaCount",
  COUNT(CASE WHEN status IN ('הושלם', 'שולם במלואו')                          THEN 1 END) AS "hofakCount",
  COUNT(CASE WHEN status IN ('תשלום ראשון התקבל')                             THEN 1 END) AS "hafkadaCount",
  COUNT(CASE WHEN status IN ('בטיפול','ממתין לפרטים','ממתין למסמכים','בבדיקה','ממתין להעברה') THEN 1 END) AS "inProcessCount",
  COUNT(CASE WHEN status IN ('בוטל', 'נגנז')                                   THEN 1 END) AS "canceledCount",
  COUNT(CASE WHEN replace = true                                               THEN 1 END) AS "replaceCount",
  COALESCE(SUM(tfuca), 0)::INT                                                      AS "totalRevenue"
`
