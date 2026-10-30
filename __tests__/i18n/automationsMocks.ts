import { vi } from 'vitest'
import { automationsEnv, ACTIVITY_ROWS, COMPOSER, QUOTE_OPTIONS, WA_TEMPLATES } from './automationsEnv'

/**
 * `vi.mock` factories for the automations screens (Phase E5b). I/O only: every
 * page, panel, sheet, dialog, card and producer runs for real (the template
 * overview and the integration overview included). Each action records its
 * arguments in `automationsEnv.calls` and answers `automationsEnv.results[name]`
 * when set (`'throw'` → it throws), else its success shape.
 */

function record<T>(name: string, success: T) {
  return async (...args: unknown[]) => {
    automationsEnv.calls.push([name, ...structuredClone(args)])
    const r = automationsEnv.results[name]
    if (r === 'throw') throw new Error(`${name} failed`)
    return structuredClone(r === undefined ? success : r) as T
  }
}

// ── session, access, flags ─────────────────────────────────────────────────
export const authModule = () => ({ getUser: async () => automationsEnv.user, isUserExists: async () => null })
export const requireUserModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')),
  requireAgencyUser: async () => automationsEnv.user,
  requireUser: async () => automationsEnv.user,
})
export const productAccessModule = () => ({ getAgencyProductAccess: async () => ({ hasAccess: automationsEnv.hasAccess }) })
export const flagsModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/automations/flags')>('@/lib/automations/flags')),
  isAutomationsAgencyAllowlisted: () => automationsEnv.allowlisted,
  isAutomationsPilotDashboardEnabled: () => automationsEnv.pilotEnabled,
  getAutomationsSendMode: () => automationsEnv.sendMode,
  getAutomationsFrom: () => automationsEnv.from,
})

// ── server reads ───────────────────────────────────────────────────────────
export const definitionsDbModule = () => ({ listDefinitions: async () => structuredClone(automationsEnv.definitions) })
export const activityDbModule = () => ({
  countRecentActivityByAutomation: async () => structuredClone(automationsEnv.counts),
  countAutomatedTodayForAgency: async () => automationsEnv.todayRuns,
})
export const leadFactsDbModule = () => ({ getAgencyName: async () => automationsEnv.agencyName, getAgencyReplyTo: async () => automationsEnv.replyTo })
export const templateInstallsDbModule = () => ({ listInstalls: async () => structuredClone(automationsEnv.installs) })
export const pilotMetricsDbModule = () => ({ getPilotMetrics: async () => structuredClone(automationsEnv.pilot) })
export const connectionUsageDbModule = () => ({ connectionUsage: async () => structuredClone(automationsEnv.usage) })
export const connectionDeliveryDbModule = () => ({ deliveryFacts: async () => structuredClone(automationsEnv.delivery) })
export const sourceLabelsDbModule = () => ({ applyCustomLabels: async (_a: number, _c: string, sources: unknown[]) => sources })
export const connectorsRegistryModule = () => ({
  listAllConnections: async () => structuredClone(automationsEnv.connections),
  resolveCapabilities: async () => new Set(automationsEnv.capabilities),
  listSourcesFor: async (_a: number, id: string) => structuredClone(automationsEnv.sources[id] ?? []),
})

/** `db('clients')…first()`: the recent lead's first name the sheet's preview greets. */
export function configDbModule() {
  const q: Record<string, unknown> = { first: async () => (automationsEnv.recentLead === null ? undefined : { firstName: automationsEnv.recentLead }) }
  for (const m of ['where', 'select', 'whereNotNull', 'orderBy']) q[m] = () => q
  return { db: () => q }
}

// ── actions ────────────────────────────────────────────────────────────────
export const manageActionsModule = () => ({
  createAutomation: record('createAutomation', { ok: true, id: 31 }),
  updateAutomation: record('updateAutomation', { ok: true, id: 11 }),
  setAutomationStatus: record('setAutomationStatus', { ok: true }),
  duplicateAutomation: record('duplicateAutomation', { ok: true, id: 32 }),
})
export const activityActionsModule = () => ({ listActivityForAutomationAction: record('listActivityForAutomationAction', { ok: true, rows: ACTIVITY_ROWS }) })
export const sendTestModule = () => ({ sendTestEmail: record('sendTestEmail', { ok: true }) })
export const connectionsActionsModule = () => ({
  listOptionsAction: record('listOptionsAction', { ok: true, options: [{ id: 'f1', label: 'טופס צור קשר' }] }),
  listOptionsForCapabilityAction: record('listOptionsForCapabilityAction', { ok: true, options: WA_TEMPLATES }),
  revokeConnection: record('revokeConnection', { ok: true }),
  provisionApiKeyConnection: record('provisionApiKeyConnection', { ok: true, webhookUrl: 'https://app.example.test/api/automations/hook/abc', secret: 'sec_123' }),
  regenerateSecret: record('regenerateSecret', { ok: true, webhookUrl: 'https://app.example.test/api/automations/hook/abc', secret: 'sec_456' }),
  connectionSetup: record('connectionSetup', { ok: true, guide: null, webhookUrl: 'https://app.example.test/api/automations/hook/abc' }),
  renameSource: record('renameSource', { ok: true }),
})
export const firstPartyOptionsModule = () => ({ listFirstPartyOptionsAction: record('listFirstPartyOptionsAction', { ok: true, options: QUOTE_OPTIONS }) })
export const previewMessageModule = () => ({
  listTemplateSlots: record('listTemplateSlots', { ok: true, slots: [{ position: 1, label: '{{1}}', field: null }, { position: 2, label: 'שם העסק', field: 'businessName' }], approved: true, bodyText: '' }),
  previewAutomationMessage: record('previewAutomationMessage', { ok: true, shape: 'message', text: 'שלום רועי, נתראה מחר', notApproved: false }),
})
export const previewEmailModule = () => ({
  previewAutomationEmail: record('previewAutomationEmail', { ok: true, shape: 'email', html: '<p>שלום רועי</p>', subjectLine: 'תודה שפנית אלינו', fromName: 'סטודיו דנה' }),
})
export const templatesActionsModule = () => ({
  installTemplate: record('installTemplate', { ok: true, created: 1 }),
  uninstallTemplate: record('uninstallTemplate', { ok: true }),
})
export const quoteActionsModule = () => ({
  getQuoteComposerDataAction: record('getQuoteComposerDataAction', { ok: true, data: COMPOSER }),
  saveQuoteTemplateAction: record('saveQuoteTemplateAction', { ok: true, templateId: 9 }),
  setQuoteTemplateStateAction: record('setQuoteTemplateStateAction', { ok: true }),
})

/** `next/navigation`: redirect throws, router calls recorded. */
export const navigationModule = (pathname = '/settings/automations') => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: (to: string) => automationsEnv.calls.push(['router.push', to]), replace: () => {}, refresh: () => automationsEnv.calls.push(['router.refresh']) }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
})

/** `@/lib/toast`: the real module (I18nProvider pushes its defaults), toasts recorded in `automationsEnv.calls`. */
export const toastModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
  toast: (...args: unknown[]) => {
    const undo = args.find((a) => typeof a === 'function') as (() => void) | undefined
    if (undo) automationsEnv.undo = undo
    automationsEnv.calls.push(['toast', ...args.filter((a) => typeof a !== 'function')])
  },
  proToast: (...args: unknown[]) => automationsEnv.calls.push(['proToast', ...args]),
})
