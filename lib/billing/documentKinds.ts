/**
 * Catalog of document kinds the picker presents.
 *
 * Adding a new kind = add an entry here + flip `enabled` when its end-to-end
 * flow is built. The picker reads this list; no UI code knows about specific
 * kinds beyond what the registry tells it.
 *
 * `routeKind` is what the URL/searchParam carries — only enabled kinds need
 * a real value. The disabled placeholders use `null` so the picker can't
 * accidentally route to a half-built flow.
 */

import type { DocumentKind } from '@/db/billing/invoices'

export type DocumentKindEntry = {
  id: string
  label: string
  description: string
  enabled: boolean
  routeKind: DocumentKind | null
}

export const DOCUMENT_KINDS: ReadonlyArray<DocumentKindEntry> = [
  {
    id: 'invoice_receipt',
    label: 'חשבונית/קבלה',
    description: 'חשבונית מס מאוחדת עם קבלה — לתיעוד הכנסה ותשלום במסמך אחד.',
    enabled: true,
    routeKind: 'invoice_receipt',
  },
  {
    id: 'deal_invoice',
    label: 'חשבון עסקה',
    description: 'מסמך עסקה ללא חיוב במע"מ.',
    enabled: false,
    routeKind: null,
  },
  {
    id: 'payment_request',
    label: 'דרישת תשלום',
    description: 'בקשה לתשלום — אינה חשבונית מס.',
    enabled: false,
    routeKind: null,
  },
  {
    id: 'order',
    label: 'הזמנה (ספר הזמנות)',
    description: 'מסמך הזמנת מוצרים או שירותים.',
    enabled: false,
    routeKind: null,
  },
  {
    id: 'quote',
    label: 'הצעת מחיר',
    description: 'הצעת מחיר ללקוח לפני ביצוע.',
    enabled: false,
    routeKind: null,
  },
  {
    id: 'credit_note',
    label: 'מסמך זיכוי',
    description: 'זיכוי כנגד חשבונית שהונפקה.',
    enabled: false,
    routeKind: null,
  },
] as const

/**
 * Short label used in chips, timeline rows, and the draft header.
 * Falls back to "חשבונית" for any unknown/legacy kind.
 */
export function documentKindLabel(kind: DocumentKind | null | undefined): string {
  if (kind === 'invoice_receipt') return 'חשבונית/קבלה'
  return 'חשבונית'
}

/**
 * Full legal title for the PDF + the issued-view hero. Mirrors Israeli
 * convention: a plain invoice is "חשבונית מס"; the combined variant is
 * "חשבונית מס/קבלה".
 */
export function documentLegalTitle(kind: DocumentKind | null | undefined): string {
  return kind === 'invoice_receipt' ? 'חשבונית מס/קבלה' : 'חשבונית מס'
}
