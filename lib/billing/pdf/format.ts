// Pure formatters shared by the HTML-based PDF renderer. Kept separate from
// any pdf-lib code so the HTML pipeline never pulls the legacy primitives
// (and so this module can be unit-tested without a Chromium binary).

export function formatPdfDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

export function formatMoney(n: number | string): string {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatQty(n: number | string): string {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return '0'
  // Render whole numbers without trailing zeros; decimal quantities keep up
  // to 4 places. Matches the previous PDF table convention.
  if (Number.isInteger(v)) return String(v)
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}
