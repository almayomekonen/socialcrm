import { billEnv, ISSUER } from './billingEnv'

/**
 * `vi.mock` factories for the billing screens (Phase E3). I/O only: every page,
 * editor, view, picker and producer runs for real. Each action records its
 * arguments in `billEnv.calls` and answers from `billEnv.results[name]`
 * (`undefined` → its success shape, `'throw'` → it throws, any other string →
 * `{ error: true, reason }`).
 */

function answer<T>(name: string, args: unknown[], success: T): T | { error: true; reason: string } {
  billEnv.calls.push([name, ...args])
  const r = billEnv.results[name]
  if (r === 'throw') throw new Error(`${name} failed`)
  if (r) return { error: true, reason: r }
  return success
}

const action = <T>(name: string, success: T) => async (...args: unknown[]) => answer(name, args, success)

/** `db(table)`: a chainable, awaitable query answering from `billEnv` by table. */
export function configDbModule() {
  const query = (table: string) => {
    const rows = () => (table === 'clients as c' ? billEnv.billedLeads : table === 'clients' ? billEnv.otherLeads : [])
    const first = async () => {
      if (table === 'agencies') return { businessType: billEnv.businessType }
      return billEnv.leadFound ? { id: 41, name: billEnv.leadName } : undefined
    }
    const q: Record<string, unknown> = { first, then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(rows()).then(ok, ko) }
    for (const m of ['where', 'whereIn', 'whereNotIn', 'innerJoin', 'groupBy', 'select', 'max', 'count', 'orderBy', 'limit']) q[m] = () => q
    return q
  }
  return { db: query }
}

export const invoicesDbModule = () => ({
  getInvoiceById: async () => (billEnv.invoice ? structuredClone(billEnv.invoice) : null),
  getInvoiceLinesByInvoiceId: async () => structuredClone(billEnv.lines),
  listInvoicesForLead: async () => [],
})
export const profilesDbModule = () => ({ getActiveBillingProfileForLead: async () => billEnv.profile })
export const documentsDbModule = () => ({ getCurrentDocumentForInvoice: async () => billEnv.document })
export const eventsDbModule = () => ({ listInvoiceEvents: async () => billEnv.events })
export const taxRatesDbModule = () => ({
  getOrCreateDefaultTaxRate: async () => ({ id: 1, ratePercent: billEnv.taxRatePercent }),
  resolveActiveTaxRateForLine: async () => ({ id: 1, ratePercent: billEnv.taxRatePercent }),
})

export const draftsActionsModule = () => ({
  saveTransientDraftAction: action('saveTransientDraftAction', { success: true, invoiceId: 77 }),
  updateDraftMetaAction: action('updateDraftMetaAction', { success: true }),
  updateDraftKindAndPaymentAction: action('updateDraftKindAndPaymentAction', { success: true }),
  deleteDraftAction: action('deleteDraftAction', { success: true }),
  addLineAction: action('addLineAction', { success: true }),
  updateLineAction: action('updateLineAction', { success: true }),
  removeLineAction: action('removeLineAction', { success: true }),
  createDraftFromLeadAction: action('createDraftFromLeadAction', { success: true, invoiceId: 77 }),
})
export const issueActionsModule = () => ({
  issueInvoiceAction: action('issueInvoiceAction', { success: true }),
  saveAndIssueTransientAction: action('saveAndIssueTransientAction', { success: true, invoiceId: 78, documentNumber: 43, documentYear: 2026, issuedAt: '2026-10-28T09:00:00.000Z', totalAmount: 100 }),
})
export const issuerActionsModule = () => ({
  updateIssuerIdentityAction: action('updateIssuerIdentityAction', { success: true }),
  getIssuerAction: async () => ({ issuer: ISSUER }),
  getIssuerCompletenessAction: async () => {
    const s = billEnv.issuer
    if (s === 'error') return { error: true, reason: 'failed' }
    if (s === 'complete') return { complete: true }
    return { complete: false, missing: ['name', 'businessType', 'taxId'], canEdit: s === 'missing-admin' }
  },
})
export const renderActionsModule = () => ({ rerenderInvoicePdfAction: action('rerenderInvoicePdfAction', { success: true }) })
export const duplicateActionsModule = () => ({ duplicateInvoiceAction: action('duplicateInvoiceAction', { success: true, invoiceId: 79 }) })
export const sendActionsModule = () => ({ sendInvoiceEmailAction: action('sendInvoiceEmailAction', { success: true }) })
export const documentStatusModule = () => ({
  getInvoicePdfStatusAction: async () => billEnv.pdfStatus ?? { status: 'rendering', url: null, errorReason: null },
})

/** `@/actions/clients` as the lead picker uses it (live search). */
export const clientsActionsModule = () => ({
  searchLeads: async (q: string) => (billEnv.calls.push(['searchLeads', q]), q === 'ללא' ? [] : structuredClone(billEnv.searchResults)),
})
