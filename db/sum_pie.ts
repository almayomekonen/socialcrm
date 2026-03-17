import { db } from '@/config/db'
import { prdctOptByBranch, BRANCHES } from '@/types/lists'

// --- Types ---
interface DbRow {
  branch: string
  prdct: string
  prdctType: string
  annualValue: number
  cmsn: number
}

interface GroupedData {
  [branch: string]: {
    [prdctType: string]: {
      [prdct: string]: { annualValue: number; cmsn: number }
    }
  }
}

// --- Main Function ---
export async function getPieData(serializedSql) {
  'use cache'

  const query = getBaseQuery(serializedSql)

  const rawData: DbRow[] = await query
    .select(
      'branch',
      'prdct',
      'prdctType',
      db.raw('COALESCE(SUM(tfuca), 0)::INT as "annualValue"'),
      db.raw('COALESCE(SUM(cmsn), 0)::INT as cmsn'),
    )
    .groupBy('branch', 'prdct', 'prdctType')

  return formatPieData(rawData)
}

function getBaseQuery(serializedSql) {
  return db.from(db.raw(`(${serializedSql.sql}) as source_table`, serializedSql.bindings))
}

function formatPieData(rawData: DbRow[]) {
  const groupedData: GroupedData = {}
  const totals: Record<string, { annualValue: number; cmsn: number }> = {}

  for (const row of rawData) {
    const { branch, prdct, prdctType, annualValue, cmsn } = row

    if (!groupedData[branch]) groupedData[branch] = {}
    if (!groupedData[branch][prdctType]) groupedData[branch][prdctType] = {}
    if (!groupedData[branch][prdctType][prdct]) {
      groupedData[branch][prdctType][prdct] = { annualValue: 0, cmsn: 0 }
    }
    groupedData[branch][prdctType][prdct].annualValue += annualValue
    groupedData[branch][prdctType][prdct].cmsn += cmsn

    if (!totals[branch]) totals[branch] = { annualValue: 0, cmsn: 0 }
    totals[branch].annualValue += annualValue
    totals[branch].cmsn += cmsn
  }

  const buildList = (branch: string, col: 'annualValue' | 'cmsn') => {
    const definedList = prdctOptByBranch[branch]?.prdctList || []
    return definedList.map((prdctItem) => {
      let val = 0
      const branchData = groupedData[branch] || {}
      Object.values(branchData).forEach((typeObj) => {
        val += typeObj[prdctItem]?.[col] || 0
      })
      return { name: prdctItem, value: val }
    })
  }

  const buildPrdctsObj = (col: 'annualValue' | 'cmsn') =>
    Object.fromEntries(BRANCHES.map((branch) => [branch, buildList(branch, col)]))

  return {
    meshuklal: BRANCHES.map((key) => ({ name: key, value: totals[key]?.cmsn || 0 })),
    // 'tfuca' key kept for UI backward compatibility — internal value now uses annualValue
    tfuca: BRANCHES.map((key) => ({ name: key, value: totals[key]?.annualValue || 0 })),
    schum: BRANCHES.map((key) => ({ name: key, value: totals[key]?.annualValue || 0 })),

    שירותים: buildList('שירותים', 'annualValue'),
    מוצרים: buildList('מוצרים', 'annualValue'),
    קורסים: buildList('קורסים', 'annualValue'),
    מנויים: buildList('מנויים', 'annualValue'),
    חבילות: buildList('חבילות', 'annualValue'),
    ייעוץ: buildList('ייעוץ', 'annualValue'),
    אחר: buildList('אחר', 'annualValue'),

    cmsnPrdcts: buildPrdctsObj('cmsn'),
    tfucaPrdcts: buildPrdctsObj('annualValue'),
  }
}
