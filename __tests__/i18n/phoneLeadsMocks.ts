import { vi } from 'vitest'
import { phoneEnv } from './phoneLeadsEnv'

/**
 * `vi.mock` factories for the phone leads tests (i18n Phase F2). Only I/O, the
 * router and the toast sink are replaced: the pages, the list, the detail, the
 * sheets, the form, the import and every producer run for real. Each action
 * records `[name, ...args]` in `phoneEnv.calls` and answers
 * `phoneEnv.results[name]` when set (`'throw'` → it throws), else `success`.
 */

function record<T>(name: string, success: T) {
  return vi.fn(async (...args: unknown[]) => {
    phoneEnv.calls.push([name, ...structuredClone(args.map((a) => (a instanceof File ? `File(${a.name})` : a)))])
    const r = phoneEnv.results[name]
    if (r === 'throw') throw new Error(`${name} failed`)
    return structuredClone(r ?? success) as T
  })
}

export const navigationModule = () => ({
  usePathname: () => '/leads',
  useRouter: () => ({
    push: (href: string) => phoneEnv.calls.push(['router.push', href]),
    replace: (href: string) => phoneEnv.calls.push(['router.replace', href]),
    refresh: () => phoneEnv.calls.push(['router.refresh']),
    back: () => {},
  }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
})

export const serverModule = async () => ({
  ...(await vi.importActual<typeof import('next/server')>('next/server')),
  after: () => {},
})

export const authModule = async () => ({ getUser: async () => (await import('./phoneLeadsEnv')).PHONE_USER })
export const uiLocaleModule = () => ({ getUiLocalePrefs: async () => ({ userLocale: phoneEnv.userLocale, agencyLocale: null }) })
export const deviceModule = () => ({ isMobileRequest: async () => true, isMobileWorkspaceRequest: async () => true, getInAppBrowser: async () => null })

export const queriesModule = () => ({
  getMobileLeadList: async (_user: unknown, _filters: unknown, page: number) => ({ rows: structuredClone(phoneEnv.rows), hasMore: phoneEnv.hasMore, page }),
  agencyHasAnyLeads: async () => phoneEnv.workspaceHasLeads,
  getMobileLeadDetail: async () => structuredClone(phoneEnv.detail),
})
export const whatsappDbModule = () => ({ getWhatsappConnectionState: async () => ({ connected: phoneEnv.waConnected }) })
export const facebookDbModule = () => ({ getFacebookConnectionState: async () => structuredClone(phoneEnv.meta) })
export const inboxQueriesModule = () => ({
  getInboxConversationByLeadId: async () => (phoneEnv.waPreview.conversationId ? { conversationId: phoneEnv.waPreview.conversationId } : null),
})
export const inboxMessagesModule = () => ({
  listConversationMessages: async () => (phoneEnv.waPreview.preview ? [{ direction: 'inbound', text: phoneEnv.waPreview.preview }] : []),
})
export const formAnswersModule = () => ({ formAnswersForLead: async () => structuredClone(phoneEnv.formAnswers) })
export const intelligenceModule = async () => ({
  getLeadIntelligence: async () => ({ ok: true, data: (await import('./phoneLeadsEnv')).INTELLIGENCE }),
})

export const clientsActionsModule = () => ({
  deleteManyLeads: record('deleteManyLeads', { deletedCount: 1, blockedCount: 0, blockedLeads: [] }),
  deleteLead: record('deleteLead', { success: true }),
  updateLead: record('updateLead', undefined),
  upsertLead: record('upsertLead', { id: 77 }),
  getLeadByIdNum: record('getLeadByIdNum', null),
  addLeads: record('addLeads', { inserted: 2, firstId: 31 }),
  importLeadsFromCsv: record('importLeadsFromCsv', { inserted: 3, updated: 0, unchanged: 0, invalid: 0 }),
  uploadLeadData: record('uploadLeadData', { data: [], wrongData: [] }),
})
export const loadMoreModule = () => ({ loadMoreMobileLeads: record('loadMoreMobileLeads', { rows: [], hasMore: false, page: 2 }) })
export const followUpModule = () => ({
  setLeadFollowUp: record('setLeadFollowUp', { ok: true }),
  clearLeadFollowUp: record('clearLeadFollowUp', { ok: true }),
})
export const outcomeModule = () => ({ logLeadOutcome: record('logLeadOutcome', { nextFollowUpAt: '2026-11-02T07:00:00.000Z' }) })
export const duplicatesModule = () => ({ findDuplicateLeads: record('findDuplicateLeads', []) })
export const inboxActionsModule = () => ({ resolveLeadWhatsappConversation: record('resolveLeadWhatsappConversation', { ok: true, conversationId: 9 }) })

/** `@/lib/toast`: the real module (the provider pushes its defaults); showing a toast is recorded. */
export const toastModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
  toast: (...args: unknown[]) => phoneEnv.calls.push(['toast', ...args]),
  proToast: (opts: unknown) => phoneEnv.calls.push(['proToast', opts]),
})

/** Every toast recorded since the last call, then cleared. */
export function takeToasts() {
  const toasts = phoneEnv.calls.filter((c) => c[0] === 'toast')
  phoneEnv.calls = phoneEnv.calls.filter((c) => c[0] !== 'toast')
  return toasts
}

/** Every recorded action call except toasts and navigation. */
export function actionCalls() {
  return phoneEnv.calls.filter((c) => c[0] !== 'toast' && !String(c[0]).startsWith('router.'))
}
