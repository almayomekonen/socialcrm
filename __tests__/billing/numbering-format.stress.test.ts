import { describe, it, expect } from 'vitest'
import { formatNumberingDisplay, formatDocumentIdentity, formatDocumentShortNumber } from '@/lib/billing/numbering'

describe('formatNumberingDisplay — legal/audit form (DO NOT CHANGE SHAPE)', () => {
  it('produces INV-YYYY-NNNNN for invoice kind', () => {
    expect(formatNumberingDisplay({ year: 2026, value: 1, kind: 'invoice' })).toBe('INV-2026-00001')
  })

  it('produces REC-YYYY-NNNNN for receipt kind', () => {
    expect(formatNumberingDisplay({ year: 2026, value: 1, kind: 'receipt' })).toBe('REC-2026-00001')
  })

  it('pads to 5 digits by default', () => {
    expect(formatNumberingDisplay({ year: 2026, value: 42, kind: 'invoice' })).toBe('INV-2026-00042')
    expect(formatNumberingDisplay({ year: 2026, value: 99999, kind: 'invoice' })).toBe('INV-2026-99999')
  })

  it('does NOT truncate values beyond 5 digits — sequence is bigint, audit must survive', () => {
    expect(formatNumberingDisplay({ year: 2026, value: 100000, kind: 'invoice' })).toBe('INV-2026-100000')
    expect(formatNumberingDisplay({ year: 2026, value: 1234567890, kind: 'invoice' })).toBe('INV-2026-1234567890')
  })

  it('custom prefix override', () => {
    expect(formatNumberingDisplay({ year: 2026, value: 1, kind: 'invoice', prefix: 'CN' })).toBe('CN-2026-00001')
  })

  it('default kind is invoice when omitted', () => {
    expect(formatNumberingDisplay({ year: 2026, value: 1 })).toBe('INV-2026-00001')
  })
})

describe('formatDocumentShortNumber — visual short form', () => {
  it('returns "#NNNNN" for issued invoices', () => {
    expect(formatDocumentShortNumber({ documentNumber: 42, docState: 'issued' })).toBe('#00042')
  })

  it('returns empty string for drafts', () => {
    expect(formatDocumentShortNumber({ documentNumber: null, docState: 'draft' })).toBe('')
  })

  it('returns empty string for drafts even if numbered (defensive)', () => {
    expect(formatDocumentShortNumber({ documentNumber: 5, docState: 'draft' })).toBe('')
  })

  it('handles voided / replaced states', () => {
    expect(formatDocumentShortNumber({ documentNumber: 7, docState: 'voided' })).toBe('#00007')
    expect(formatDocumentShortNumber({ documentNumber: 7, docState: 'replaced' })).toBe('#00007')
  })

  it('grows past 5 digits without truncation', () => {
    expect(formatDocumentShortNumber({ documentNumber: 1234567, docState: 'issued' })).toBe('#1234567')
  })

  it('zero documentNumber edge — renders #00000 (documents current behavior)', () => {
    expect(formatDocumentShortNumber({ documentNumber: 0, docState: 'issued' })).toBe('#00000')
  })
})

describe('formatDocumentIdentity — branded kind-aware identity', () => {
  it('plain invoice', () => {
    expect(formatDocumentIdentity({ documentNumber: 3, docState: 'issued', kind: 'invoice' })).toBe('חשבונית #00003')
  })

  it('combined invoice/receipt', () => {
    expect(formatDocumentIdentity({ documentNumber: 3, docState: 'issued', kind: 'invoice_receipt' })).toBe('חשבונית/קבלה #00003')
  })

  it('draft returns generic "טיוטה" — no leaked number', () => {
    expect(formatDocumentIdentity({ documentNumber: null, docState: 'draft', kind: 'invoice' })).toBe('טיוטה')
  })

  it('draft with stray documentNumber still returns "טיוטה"', () => {
    expect(formatDocumentIdentity({ documentNumber: 5, docState: 'draft', kind: 'invoice_receipt' })).toBe('טיוטה')
  })

  it('large invoice numbers render without truncation', () => {
    expect(formatDocumentIdentity({ documentNumber: 1000000, docState: 'issued', kind: 'invoice' })).toBe('חשבונית #1000000')
  })
})
