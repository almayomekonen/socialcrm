/**
 * Numbering policy: kinds, default formatting, and the prefix catalog.
 *
 * The data-access side (allocation under row lock) lives in
 * db/billing/numbering.ts. This module is the place where future
 * per-agency prefix overrides or padding choices land — currently the
 * defaults are hardcoded.
 */

export const NUMBERING_KINDS = ['invoice', 'receipt'] as const
export type NumberingKind = (typeof NUMBERING_KINDS)[number]

export const DEFAULT_INVOICE_PREFIX = 'INV'
export const DEFAULT_RECEIPT_PREFIX = 'REC'
export const DEFAULT_NUMBER_PAD = 5

export function defaultPrefixFor(kind: NumberingKind): string {
  return kind === 'invoice' ? DEFAULT_INVOICE_PREFIX : DEFAULT_RECEIPT_PREFIX
}

export type FormatNumberingDisplayInput = {
  year: number
  value: number
  kind?: NumberingKind
  prefix?: string
  pad?: number
}

/**
 * Audit / canonical identifier, e.g. "INV-2026-00042". Used in stored event
 * payloads and any surface that needs a stable copy-paste reference. NOT the
 * default for visual surfaces anymore — those use formatDocumentIdentity.
 *
 * Pure function — same inputs always produce same output. Do NOT change the
 * shape: historical event rows store this exact form and re-rendering them
 * with a different formatter would mutate the audit trail.
 */
export function formatNumberingDisplay(input: FormatNumberingDisplayInput): string {
  const prefix = input.prefix ?? (input.kind ? defaultPrefixFor(input.kind) : DEFAULT_INVOICE_PREFIX)
  const pad = input.pad ?? DEFAULT_NUMBER_PAD
  const padded = String(input.value).padStart(pad, '0')
  return `${prefix}-${input.year}-${padded}`
}

/**
 * Returns the zero-padded sequence number with a leading "#", e.g. "#00042".
 * For drafts (no allocated number) returns an empty string. Useful when the
 * surrounding context already names the document kind — e.g. the PDF body,
 * where the legal title sits directly above this short form.
 */
export function formatDocumentShortNumber(input: {
  documentNumber: number | null
  docState: 'draft' | 'issued' | 'voided' | 'replaced'
  pad?: number
}): string {
  if (input.docState === 'draft' || input.documentNumber == null) return ''
  const pad = input.pad ?? DEFAULT_NUMBER_PAD
  return `#${String(input.documentNumber).padStart(pad, '0')}`
}

/**
 * Branded, kind-aware identity for visual headings — list rows, hero, modal
 * titles, email subject, timeline labels. Returns:
 *
 *   draft                 → "טיוטה"
 *   kind='invoice'        → "חשבונית #00042"
 *   kind='invoice_receipt'→ "חשבונית/קבלה #00042"
 *
 * The year is intentionally omitted from the visual — surfaces that show
 * this identity already render the issued date next to it, so the year is
 * redundant in the dominant text. The DB row still carries documentYear;
 * the audit form (formatNumberingDisplay) is what preserves it.
 */
export function formatDocumentIdentity(input: {
  documentNumber: number | null
  docState: 'draft' | 'issued' | 'voided' | 'replaced'
  kind: 'invoice' | 'invoice_receipt'
  pad?: number
}): string {
  if (input.docState === 'draft' || input.documentNumber == null) return 'טיוטה'
  const noun = input.kind === 'invoice_receipt' ? 'חשבונית/קבלה' : 'חשבונית'
  const pad = input.pad ?? DEFAULT_NUMBER_PAD
  return `${noun} #${String(input.documentNumber).padStart(pad, '0')}`
}
