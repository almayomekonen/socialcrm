import { describe, it, expect } from 'vitest'
import { formatPieData } from '@/db/sum_pie'
import { prdctOptByBranch } from '@/types/lists'

/** Rows exactly as getPieData's GROUP BY (branch, prdct, prdctType) returns them. */
const row = (branch: string, prdct: string, amount: number, prdctType = 'תשלום חד פעמי') => ({
  branch,
  prdct,
  prdctType,
  annualValue: amount,
  cmsn: amount,
})

const slice = (pie: { name: string; value: number }[], name: string) => pie.find((s) => s.name === name)?.value
const sum = (pie: { value: number }[]) => pie.reduce((t, s) => t + s.value, 0)
const branchTotal = (data: ReturnType<typeof formatPieData>, branch: string) => slice(data.schum, branch)

describe('formatPieData — product pies', () => {
  it('keeps a predefined product in its own slice', () => {
    const data = formatPieData([row('שירותים', 'SEO', 1200)])
    expect(slice(data['שירותים'], 'SEO')).toBe(1200)
    expect(slice(data['שירותים'], 'אחר')).toBe(0)
  })

  it('counts a free-text product (e.g. an imported deal description) under אחר', () => {
    const data = formatPieData([row('שירותים', 'תשלום עבור ליווי עסקי', 1500)])
    expect(slice(data['שירותים'], 'אחר')).toBe(1500)
    // The free-text name never becomes a slice of its own.
    expect(data['שירותים'].map((s) => s.name)).toEqual(prdctOptByBranch['שירותים'].prdctList)
  })

  it('aggregates several unknown products and a real אחר row into one אחר slice, once each', () => {
    const data = formatPieData([
      row('שירותים', 'תשלום 1 מתוך 8', 1000),
      row('שירותים', 'מנוי חודשי', 89, 'תשלום חודשי'),
      row('שירותים', 'אחר', 300),
      row('שירותים', 'בניית אתר', 5000),
    ])
    expect(slice(data['שירותים'], 'אחר')).toBe(1000 + 89 + 300)
    expect(slice(data['שירותים'], 'בניית אתר')).toBe(5000)
    // No double counting: every row lands in exactly one slice.
    expect(sum(data['שירותים'])).toBe(1000 + 89 + 300 + 5000)
  })

  it('reconciles every branch product pie with that branch total, for legacy/unknown values too', () => {
    const rows = [
      row('שירותים', 'SEO', 700),
      row('שירותים', 'legacy value', 50),
      row('מוצרים', 'מוצר דיגיטלי', 400),
      row('מוצרים', 'SEO', 120), // a product listed under a DIFFERENT branch is unknown here
      row('קורסים', 'סדנה', 900),
      row('אחר', 'משהו', 30),
    ]
    const data = formatPieData(rows)
    for (const branch of ['שירותים', 'מוצרים', 'קורסים', 'אחר']) {
      expect(sum(data[branch]), branch).toBe(branchTotal(data, branch))
    }
    expect(slice(data['מוצרים'], 'אחר')).toBe(120)
    expect(slice(data['שירותים'], 'אחר')).toBe(50)
    // The tooltip breakdowns come from the same lists and reconcile the same way.
    expect(sum(data.tfucaPrdcts['שירותים'])).toBe(750)
  })
})
