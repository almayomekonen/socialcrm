import { formatDate, formatDateTime } from '../dates'
import { formatCurrency, formatPrecent, formatRoundCurrency, formatShortCurrency } from '../funcs'

export function checkedIds(container?: HTMLElement | Document | null) {
  const root: ParentNode = container ?? document
  const checkItems = root.querySelectorAll("[name='checkRow']:checked") as NodeListOf<HTMLInputElement>

  return Array.from(checkItems).map((item) => Number(item.id))
}

export function sortTable(col, direction, data) {
  const sortedArray = data.sort((a, b) => {
    let val1 = a[col] || '0'
    let val2 = b[col] || '0'

    if (val1 < val2) return direction === 'asc' ? -1 : 1
    if (val1 > val2) return direction === 'asc' ? 1 : -1
  })

  return sortedArray
}

export function onCheckAll(e?: { currentTarget?: HTMLInputElement }) {
  const header =
    (e?.currentTarget as HTMLInputElement | undefined) ?? (document.getElementById('checkAll') as HTMLInputElement | null)
  if (!header) return
  const checked = header.checked
  const scope: ParentNode = (header.closest('.tbl') as HTMLElement | null) ?? document
  const checkItems = scope.querySelectorAll("[name='checkRow']") as NodeListOf<HTMLInputElement>
  checkItems.forEach((item) => {
    if (item.checked !== checked) {
      item.checked = checked
      item.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
}

// export function getNestedValue(obj, keys) {
//   if (!keys.includes('.')) return obj[keys]
//   return keys.split('.').reduce((acc, key) => acc[key], obj)
// }

export function getNestedValue(obj, keys) {
  if (!keys.includes('.')) return obj ? obj[keys] : ''
  return keys.split('.').reduce((acc, key) => (acc ? acc[key] : ''), obj)
}

export const formatFuncs = {
  formatDate,
  formatCurrency,
  formatDateTime,
  formatPrecent,
  formatShortCurrency,
  formatRoundCurrency,
}
