import { vi } from 'vitest'
import { setEnv } from './settingsEnv'

/**
 * `vi.mock` factories for the user settings screens (Phase E4). I/O only: every
 * page, form, card, dialog and producer runs for real. Each action records its
 * arguments in `setEnv.calls` and answers `setEnv.results[name]` when set
 * (`'throw'` / `'throw:<message>'` → it throws), else its success shape.
 */

function record<T>(name: string, success: T) {
  return async (...args: unknown[]) => {
    setEnv.calls.push([name, ...args])
    const r = setEnv.results[name]
    if (r === 'throw') throw new Error(`${name} failed`)
    if (typeof r === 'string' && r.startsWith('throw:')) throw new Error(r.slice(6))
    return (r ?? success) as T
  }
}

// ── session, device, access ────────────────────────────────────────────────
export const authModule = () => ({
  getUser: async () => setEnv.user,
  // The WhatsApp phone picker's cookie (display data only).
  decrypt: async () => (setEnv.pendingPhones ? { userId: setEnv.user.id, phones: setEnv.pendingPhones } : null),
})
export const requireUserModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')),
  requireAgencyUser: async () => setEnv.user,
  requireUser: async () => setEnv.user,
})
export const deviceModule = () => ({
  isMobileRequest: async () => setEnv.mobile,
  isMobileWorkspaceRequest: async () => setEnv.mobile,
  getInAppBrowser: async () => null,
})
export const productAccessModule = () => ({ getAgencyProductAccess: async () => ({ hasAccess: setEnv.hasAccess }) })
export const headersModule = () => ({
  cookies: async () => ({ get: (name: string) => (name === 'wa_phones' && setEnv.pendingPhones ? { value: 'sealed' } : undefined) }),
  headers: async () => new Headers(),
})

// ── account pages ──────────────────────────────────────────────────────────
export const usersNTeamsDbModule = () => ({
  getFullUser: async () => structuredClone(setEnv.fullUser),
  getUsers: async () => structuredClone(setEnv.users),
  getExtUsersCreatedByUser: async () => structuredClone(setEnv.extUsers),
  getDefaultSettings: async () => structuredClone(setEnv.defaults),
})
export const filterDbModule = () => ({ getPerms: async () => ({ gotPermIds: [], gotPermUsers: [], allPermUsers: [], gavePermUsers: structuredClone(setEnv.gavePerm) }) })
export const loginActivityModule = () => ({ getRecentLoginActivity: async () => structuredClone(setEnv.loginActivity) })
export const usersNteamsActionsModule = () => ({
  updateFullUser: record('updateFullUser', undefined),
  updateUserInfoData: record('updateUserInfoData', undefined),
  updateDefaultSettings: record('updateDefaultSettings', undefined),
  updateGavePerm: record('updateGavePerm', undefined),
  removeAuthUser: record('removeAuthUser', undefined),
  upsertExtUser: record('upsertExtUser', undefined),
  deleteExtUser: record('deleteExtUser', undefined),
  transferSales: record('transferSales', undefined),
})
export const filterActionsModule = () => ({ updateSavedFilters: record('updateSavedFilters', undefined), addSavedFilters: record('addSavedFilters', undefined) })
export const linkFacebookModule = () => ({ linkFacebookAccount: record('linkFacebookAccount', { ok: true }) })
export const facebookUserAuthFlagsModule = () => ({ canUseFacebookUserAuth: () => setEnv.facebookUserAuth })
export const remindersFlagsModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/flags/ownerWhatsappReminderFlags')>('@/lib/flags/ownerWhatsappReminderFlags')),
  canUseOwnerWhatsappReminders: () => setEnv.remindersAudience,
})
export const ownerRecipientsModule = () => ({ getOwnRecipient: async () => structuredClone(setEnv.reminderRow) })
export const remindersActionsModule = () => ({
  startWhatsappReminderActivation: record('startWhatsappReminderActivation', { ok: true, code: '482-913', waMeHref: 'https://wa.me/972500000000?text=x' }),
  turnOffWhatsappReminders: record('turnOffWhatsappReminders', { ok: true }),
})
export const issuerDbModule = () => ({ getIssuer: async () => structuredClone(setEnv.issuer) })
export const issuerActionsModule = () => ({ updateIssuerIdentityAction: record('updateIssuerIdentityAction', { success: true }) })
export const filesActionsModule = () => ({ getUserImgs: async () => [], getPresigned: record('getPresigned', []), addFiles: record('addFiles', []), deleteFile: record('deleteFile', undefined), addFilesToTask: record('addFilesToTask', undefined) })

// ── payment ────────────────────────────────────────────────────────────────
export const quotaModule = () => ({ getAgencyPlan: async () => setEnv.plan, getQuotaStatus: async () => ({ overQuotaCount: 0 }) })
export const planUsageModule = () => ({ getPlanUsage: async () => structuredClone(setEnv.usage) })
export const subscriptionModule = () => ({ getSubscriptionView: async () => structuredClone(setEnv.subscription) })
export const recoverCardModule = () => ({ refreshCardSetupState: async () => {} })
export const cardTrialViewModule = () => ({ getCardTrialView: async () => structuredClone(setEnv.cardView) })
export const trialDbModule = () => ({ getAgencyTrial: async () => structuredClone(setEnv.trialRow) })
export const availabilityModule = () => ({
  isCardBillingAvailable: () => setEnv.billingAvailable,
  billingSetupPurpose: async () => setEnv.setupPurpose,
  describeCardBillingAvailability: () => ({ ok: setEnv.billingAvailable, reason: setEnv.billingAvailable ? 'ok' : 'missing_env' }),
})
export const subscriptionActionsModule = () => ({ cancelRenewal: record('cancelRenewal', { ok: true }), resumeRenewal: record('resumeRenewal', { ok: true }) })
export const paymentMethodActionsModule = () => ({ startCardSetup: record('startCardSetup', { url: 'https://grow.example.test/pay' }) })
export const trialActionsModule = () => ({ trackTrialStartClicked: async () => {}, trackTrialStartFailed: async () => {} })

/** `db(table)`: chainable + awaitable, answering from `setEnv` by table. */
export function configDbModule() {
  const query = (table: string) => {
    const rows = () => (table === 'payments' ? structuredClone(setEnv.charges) : [])
    const first = async () => {
      if (table === 'users') return { facebookSub: setEnv.facebookLinked ? 'fb-1' : null }
      if (table === 'facebook_pages') return setEnv.fbPage ? structuredClone(setEnv.fbPage) : undefined
      return undefined
    }
    const q: Record<string, unknown> = { first, then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(rows()).then(ok, ko) }
    for (const m of ['where', 'whereIn', 'orderBy', 'select', 'limit', 'pluck']) q[m] = () => q
    return q
  }
  return { db: query }
}

// ── integrations ───────────────────────────────────────────────────────────
export const pendingPagesModule = () => ({
  PENDING_PAGES_COOKIE: 'fb_pages',
  readPendingPages: async () => setEnv.pendingPages,
  toClientPages: (p: unknown) => (p ? structuredClone(p) : null),
})
export const facebookHealthModule = () => ({ checkFacebookConnection: async () => structuredClone(setEnv.fbHealth) })
export const pageTokenModule = () => ({ resolvePageAccessToken: (t: string) => t })
export const facebookDbModule = async () => ({
  getFacebookCommentTextCapability: async () => ({ needsReconnect: false }),
  getFacebookConnectionState: async () => ({ connected: !!setEnv.fbPage }),
  parseGrantedScopes: (await vi.importActual<typeof import('@/db/facebook')>('@/db/facebook')).parseGrantedScopes,
})
export const commentsCapabilityModule = () => ({ isFacebookCommentsEnabledForAgency: () => setEnv.commentsEnabled })
export const registrationModule = () => ({ checkMessagingReady: async () => setEnv.waReady })
export const operationalStatusModule = () => ({ resolveWhatsappHealth: async () => ({ primary: setEnv.waStatus }) })
export const whatsappDbModule = () => ({
  getWhatsappConnectionForAgency: async () => structuredClone(setEnv.waConnection),
  getWhatsappConnectionState: async () => ({ connected: !!setEnv.waConnection }),
})
export const templatesFlagModule = () => ({ isTemplatesEnabledForAgency: () => setEnv.templatesEnabled })
export const templatesDbModule = () => ({
  listTemplates: async () => structuredClone(setEnv.templates),
  countByStatus: async () => structuredClone(setEnv.templateCounts),
})
export const messengerSectionModule = () => ({ loadMessengerSection: async () => structuredClone(setEnv.messenger) })
export const automationsFlagsModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/automations/flags')>('@/lib/automations/flags')),
  isAutomationsAgencyAllowlisted: () => false,
})
export const calendarConnModule = () => ({ getCalendarConnectionByUserId: async () => structuredClone(setEnv.calendar) })
export const mcpFlagsModule = () => ({ canUseMcp: () => setEnv.mcp })
export const aiConnectionsModule = () => ({ listAiConnections: async () => structuredClone(setEnv.aiConnections) })
export const oauthConfigModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/oauth/server/config')>('@/lib/oauth/server/config')),
  mcpResource: () => 'https://mcp.example.test/mcp',
})
export const embeddedSignupModule = () => ({
  useEmbeddedSignup: () => ({ launch: async () => (setEnv.calls.push(['launch']), (setEnv.results.launch as object) ?? { ok: false, error: 'cancelled' }) }),
})
export const adaptivePollModule = () => ({ useAdaptivePoll: () => {} })
export const templatesActionsModules = {
  create: () => ({ createTemplate: record('createTemplate', { ok: true, template: { id: 90, displayTitle: 'חדש', status: 'pending', bodyText: 'x', variables: [], failureText: null, archived: false, createdAt: '2026-10-28T09:00:00.000Z' } }) }),
  retry: () => ({ retryTemplate: record('retryTemplate', { ok: true, template: { id: 91, displayTitle: 'חדש', status: 'pending', bodyText: 'x', variables: [], failureText: null, archived: false, createdAt: '2026-10-28T09:00:00.000Z' } }) }),
  archive: () => ({ archiveTemplate: record('archiveTemplate', { ok: true }) }),
  discard: () => ({ discardTemplate: record('discardTemplate', { ok: true }) }),
}
export const messengerProfileActionsModule = () => ({
  updateMessengerProfile: record('updateMessengerProfile', { ok: true }),
  importMessengerConversations: record('importMessengerConversations', { ok: true }),
})
export const savedReplyActionsModule = () => ({
  createSavedReply: record('createSavedReply', { ok: true, reply: { id: 6, title: 'חדשה', body: 'גוף', quickReplies: [], buttons: [], attachmentUrl: null, attachmentType: null } }),
  updateSavedReply: record('updateSavedReply', { ok: true, reply: { id: 5, title: 'שעות פעילות', body: 'עודכן', quickReplies: [], buttons: [], attachmentUrl: null, attachmentType: null } }),
  deleteSavedReply: record('deleteSavedReply', { ok: true }),
})
export const oauthGrantsActionsModule = () => ({ disconnectAiConnection: record('disconnectAiConnection', { ok: true }) })
export const nextScriptModule = () => ({ default: () => null })

/** `next/navigation`: the URL comes from `setEnv.searchParams`, read when a client part renders. */
export const navigationModule = (pathname = '/settings/integrations') => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => setEnv.calls.push(['router.refresh']) }),
  useSearchParams: () => new URLSearchParams(setEnv.searchParams),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  unstable_rethrow: () => {},
})

/** `@/lib/toast`: the real module (I18nProvider pushes its defaults), toasts recorded in `setEnv.calls`. */
export const toastModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
  toast: (...args: unknown[]) => setEnv.calls.push(['toast', ...args]),
  proToast: (...args: unknown[]) => setEnv.calls.push(['proToast', ...args]),
})
