/**
 * Shared types + numeric helpers + cell-input styling for the invoice
 * lines table. Lives in one file so LineRow and NewLineRow agree on
 * shape without circular imports.
 */

export type EditableLine = {
  id: number
  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  lineSubtotal: number
  lineTaxAmount: number
  lineTotal: number
}

export type LineFormPayload = {
  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
}

/**
 * Cell input styling: always-visible field surface so each cell reads
 * as editable. Hover/focus lift to white with stronger border. Calm
 * but unmistakably operable.
 */
export const cellInputCls =
  'w-full h-11 px-3 rounded-md bg-gray-50 border border-gray-200 text-base ' +
  'hover:bg-white hover:border-gray-300 ' +
  'focus:bg-white focus:border-gray-400 focus:outline-2 focus:outline-offset-0 focus:outline-blue-100 ' +
  'transition-colors placeholder:text-gray-400'

export const cellSubInputCls =
  'w-full h-9 mt-1 px-3 rounded-md bg-gray-50 border border-gray-200 ' +
  'hover:bg-white hover:border-gray-300 ' +
  'focus:bg-white focus:border-gray-400 focus:outline-2 focus:outline-offset-0 focus:outline-blue-100 ' +
  'transition-colors text-sm text-gray-500 placeholder:text-gray-400'

export function formatField(n: number): string {
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export function parseNum(s: string, fallback: number): number {
  if (!s?.trim()) return fallback
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}
