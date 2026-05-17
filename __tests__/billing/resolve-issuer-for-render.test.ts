import { describe, it, expect } from 'vitest'
import { resolveIssuerForRender } from '@/lib/billing/issuer/resolveForRender'
import type { IssuerData } from '@/lib/billing/issuer/fields'

/**
 * Unit tests for the Phase 2.1 issuer-snapshot resolver.
 *
 * The resolver is the single point where the render-time precedence is
 * applied:
 *   1. invoice.issuer*Snapshot column (non-empty)       — frozen at issue
 *   2. liveIssuer.* (non-null/non-empty)                — drafts; legacy issued
 *   3. fallbackAgencyName                               — name only, pre-Phase-1c
 *
 * These tests pin those rules down so a future refactor can't silently
 * weaken historical-document immutability. The PDF/email surfaces both
 * pipe through this helper — a bug here is a bug everywhere.
 */

const liveIssuer: IssuerData = {
  name: 'Live Business Name',
  businessType: 'authorized',
  taxId: '999999999',
  address: 'Live Address 1, Tel Aviv',
  phone: '054-1111111',
  email: 'live@example.com',
  img: 42,
  country: 'IL',
  defaultCurrency: 'ILS',
  locale: 'he',
  docNumberFormat: 'YYYY-NNNN',
  bankDetails: {},
}

const snapshotInvoice = {
  issuerNameSnapshot: 'Snapshot Business Name',
  issuerBusinessTypeSnapshot: 'exempt' as const,
  issuerTaxIdSnapshot: '111111111',
  issuerAddressSnapshot: 'Snapshot Address 1',
  issuerPhoneSnapshot: '052-0000000',
  issuerEmailSnapshot: 'snapshot@example.com',
}

const emptyInvoice = {
  issuerNameSnapshot: '',
  issuerBusinessTypeSnapshot: null,
  issuerTaxIdSnapshot: '',
  issuerAddressSnapshot: '',
  issuerPhoneSnapshot: '',
  issuerEmailSnapshot: '',
}

describe('resolveIssuerForRender', () => {
  describe('snapshot wins (post-migration issued invoices)', () => {
    it('renders snapshot values even when live values differ', () => {
      const out = resolveIssuerForRender({
        invoice: snapshotInvoice,
        liveIssuer,
        fallbackAgencyName: 'Some Agency',
      })

      expect(out.name).toBe('Snapshot Business Name')
      expect(out.businessType).toBe('exempt')
      expect(out.taxId).toBe('111111111')
      expect(out.address).toBe('Snapshot Address 1')
      expect(out.phone).toBe('052-0000000')
      expect(out.email).toBe('snapshot@example.com')
    })

    it('uses snapshot values even when live is null (deleted-agency edge)', () => {
      const out = resolveIssuerForRender({
        invoice: snapshotInvoice,
        liveIssuer: null,
        fallbackAgencyName: '',
      })

      expect(out.name).toBe('Snapshot Business Name')
      expect(out.taxId).toBe('111111111')
    })

    it('trims surrounding whitespace from snapshot values', () => {
      const out = resolveIssuerForRender({
        invoice: { ...snapshotInvoice, issuerNameSnapshot: '   Padded Name   ' },
        liveIssuer,
        fallbackAgencyName: 'Some Agency',
      })

      expect(out.name).toBe('Padded Name')
    })
  })

  describe('live fallback (drafts and legacy issued invoices)', () => {
    it('falls through to live when snapshot fields are empty', () => {
      const out = resolveIssuerForRender({
        invoice: emptyInvoice,
        liveIssuer,
        fallbackAgencyName: 'Some Agency',
      })

      expect(out.name).toBe('Live Business Name')
      expect(out.businessType).toBe('authorized')
      expect(out.taxId).toBe('999999999')
      expect(out.address).toBe('Live Address 1, Tel Aviv')
      expect(out.phone).toBe('054-1111111')
      expect(out.email).toBe('live@example.com')
    })

    it('whitespace-only snapshot is treated as empty and falls through to live', () => {
      const out = resolveIssuerForRender({
        invoice: { ...emptyInvoice, issuerNameSnapshot: '   ' },
        liveIssuer,
        fallbackAgencyName: 'Some Agency',
      })

      expect(out.name).toBe('Live Business Name')
    })
  })

  describe('agency.name fallback (pre-Phase-1c legacy)', () => {
    it('returns fallbackAgencyName when both snapshot and live name are empty', () => {
      const out = resolveIssuerForRender({
        invoice: emptyInvoice,
        liveIssuer: { ...liveIssuer, name: null },
        fallbackAgencyName: 'Legacy Agency Inc.',
      })

      expect(out.name).toBe('Legacy Agency Inc.')
    })

    it('returns null name when every layer is empty', () => {
      const out = resolveIssuerForRender({
        invoice: emptyInvoice,
        liveIssuer: { ...liveIssuer, name: null },
        fallbackAgencyName: '   ',
      })

      expect(out.name).toBeNull()
    })

    it('fallback applies only to name — other empty fields stay null', () => {
      const out = resolveIssuerForRender({
        invoice: emptyInvoice,
        liveIssuer: null,
        fallbackAgencyName: 'Legacy Agency Inc.',
      })

      expect(out.name).toBe('Legacy Agency Inc.')
      expect(out.taxId).toBeNull()
      expect(out.address).toBeNull()
      expect(out.phone).toBeNull()
      expect(out.email).toBeNull()
    })
  })

  describe('logo passthrough (Priority 6 will revisit)', () => {
    it('always reads img from liveIssuer (no snapshot column yet)', () => {
      const out = resolveIssuerForRender({
        invoice: snapshotInvoice,
        liveIssuer,
        fallbackAgencyName: 'Some Agency',
      })

      expect(out.img).toBe(42)
    })

    it('img is null when liveIssuer is null', () => {
      const out = resolveIssuerForRender({
        invoice: snapshotInvoice,
        liveIssuer: null,
        fallbackAgencyName: 'Some Agency',
      })

      expect(out.img).toBeNull()
    })
  })

  describe('Tier 3 passthrough (not snapshotted in Phase 2.1)', () => {
    it('passes Tier-3 fields straight from liveIssuer', () => {
      const out = resolveIssuerForRender({
        invoice: snapshotInvoice,
        liveIssuer: {
          ...liveIssuer,
          country: 'US',
          defaultCurrency: 'USD',
          locale: 'en',
          docNumberFormat: 'INV-NNNN',
          bankDetails: { iban: 'IL1234' },
        },
        fallbackAgencyName: 'Some Agency',
      })

      expect(out.country).toBe('US')
      expect(out.defaultCurrency).toBe('USD')
      expect(out.locale).toBe('en')
      expect(out.docNumberFormat).toBe('INV-NNNN')
      expect(out.bankDetails).toEqual({ iban: 'IL1234' })
    })

    it('uses canonical defaults when liveIssuer is null', () => {
      const out = resolveIssuerForRender({
        invoice: snapshotInvoice,
        liveIssuer: null,
        fallbackAgencyName: 'Some Agency',
      })

      expect(out.country).toBe('IL')
      expect(out.defaultCurrency).toBe('ILS')
      expect(out.locale).toBe('he')
      expect(out.docNumberFormat).toBe('YYYY-NNNN')
      expect(out.bankDetails).toEqual({})
    })
  })
})
