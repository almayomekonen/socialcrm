import { formatDate, formatDateTime } from '../dates'
import { formatCurrency, formatPrecent, formatRoundCurrency, formatShortCurrency } from '../funcs'

export function checkedIds() {
  const checkItems = document.querySelectorAll("[name='checkRow']:checked") as NodeListOf<HTMLInputElement>

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

export function onCheckAll() {
  const checked = (document.getElementById('checkAll') as HTMLInputElement).checked
  const checkItems = document.querySelectorAll("[name='checkRow']") as NodeListOf<HTMLInputElement>
  checkItems.forEach((item) => {
    item.checked = checked
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
