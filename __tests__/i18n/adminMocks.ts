import { vi } from 'vitest'
import { adminEnv } from './adminEnv'

/**
 * `vi.mock` factories for the admin settings screens (Phase E5a). I/O only:
 * every page, table, form, dialog and producer runs for real. Each action
 * records its arguments in `adminEnv.calls` and answers `adminEnv.results[name]`
 * when set (`'throw'` → it throws), else its success shape.
 */

function record<T>(name: string, success: T) {
  return async (...args: unknown[]) => {
    adminEnv.calls.push([name, ...structuredClone(args)])
    const r = adminEnv.results[name]
    if (r === 'throw') throw new Error(`${name} failed`)
    return (r === undefined ? success : r) as T
  }
}

// ── session, device, access ────────────────────────────────────────────────
export const authModule = () => ({ getUser: async () => adminEnv.user, isUserExists: record('isUserExists', null) })
export const requireUserModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')),
  requireAgencyUser: async () => adminEnv.user,
  requireUser: async () => adminEnv.user,
})
export const deviceModule = () => ({
  isMobileRequest: async () => adminEnv.mobile,
  isMobileWorkspaceRequest: async () => adminEnv.mobile,
  getInAppBrowser: async () => null,
})
export const productAccessModule = () => ({ getAgencyProductAccess: async () => ({ hasAccess: adminEnv.hasAccess }) })

// ── users, teams, invitations ──────────────────────────────────────────────
export const usersNTeamsDbModule = () => ({
  getAllPropsUsers: async () => structuredClone(adminEnv.allUsers),
  getTeams: async () => structuredClone(adminEnv.teams),
  getAllTeams: async () => structuredClone(adminEnv.allTeams),
  getUsers: async () => structuredClone(adminEnv.teamUsers),
})
export const invitationsDbModule = () => ({ getInvitations: async () => structuredClone(adminEnv.invitations) })
export const usersNteamsActionsModule = () => ({
  deleteUser: record('deleteUser', undefined),
  fetchIsUserHaveSales: record('fetchIsUserHaveSales', false),
  upsertUser: record('upsertUser', undefined),
  upsertUserNPerms: record('upsertUserNPerms', undefined),
  transferSales: record('transferSales', undefined),
  deleteTeam: record('deleteTeam', undefined),
  upsertTeam: record('upsertTeam', undefined),
})
export const invitationsActionsModule = () => ({
  sendInvitation: record('sendInvitation', { success: true }),
  deleteInvitation: record('deleteInvitation', undefined),
})
export const globalActionsModule = () => ({ saveTblPref: record('saveTblPref', { ok: true }) })

// ── campaigns, task templates ──────────────────────────────────────────────
export const promosDbModule = () => ({ getPromos: async () => structuredClone(adminEnv.promos) })
export const promosActionsModule = () => ({ upsertPromo: record('upsertPromo', undefined), deletePromo: record('deletePromo', undefined) })
export const filesActionsModule = () => ({ getUserImgs: async () => [], getPresigned: record('getPresigned', []), addFiles: record('addFiles', []), deleteFile: record('deleteFile', undefined), addFilesToTask: record('addFilesToTask', undefined) })
export const tasksDbModule = () => ({
  getTaskTmplts: async () => structuredClone(adminEnv.taskTmplts),
  getTaskTmpltById: async () => structuredClone(adminEnv.taskTmplt),
})
export const tasksActionsModule = () => ({
  addTaskTmplt: record('addTaskTmplt', 41),
  deleteTaskTmplt: record('deleteTaskTmplt', undefined),
  updateFullTaskTmplt: record('updateFullTaskTmplt', undefined),
  updateFullTask: record('updateFullTask', undefined),
})

// ── quote templates ────────────────────────────────────────────────────────
export const quoteWritesDbModule = () => ({
  loadQuoteTemplateWorkspace: async () => ({ overviews: structuredClone(adminEnv.quoteOverviews), documents: structuredClone(adminEnv.quoteDocuments) }),
})
export const quoteActionsModule = () => ({
  saveQuoteTemplateAction: record('saveQuoteTemplateAction', { ok: true, templateId: 9 }),
  setQuoteTemplateStateAction: record('setQuoteTemplateStateAction', { ok: true }),
})

// ── auto-response ──────────────────────────────────────────────────────────
export const autoResponseDbModule = () => ({
  getMasterEnabled: async () => adminEnv.master,
  getChannelSettings: async () => structuredClone(adminEnv.channel),
})
export const builderFlagsModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/flags/questionnaireBuilderFlags')>('@/lib/flags/questionnaireBuilderFlags')),
  canUseQuestionnaireBuilder: () => adminEnv.builder,
})
export const updateAutoResponseModule = () => ({ updateAutoResponseSettings: record('updateAutoResponseSettings', { ok: true, unsupportedRequests: [] }) })
export const previewAgentModule = () => ({
  previewAgentTurn: record('previewAgentTurn', { ok: true, reply: 'שלום! במה אפשר לעזור?', usedDraft: false, trace: { simulated: null } }),
})
// The phone branch is Phase F (not rendered on desktop).
export const autoResponseMobileModule = () => ({ default: () => null })

/** `db(table)`: the agency name read by auto-response. */
export function configDbModule() {
  const q: Record<string, unknown> = { first: async () => (adminEnv.agencyName === null ? undefined : { name: adminEnv.agencyName }) }
  for (const m of ['where', 'select', 'whereNotNull', 'orderBy']) q[m] = () => q
  return { db: () => q }
}

/** `next/navigation`: redirect / notFound throw, router calls recorded. */
export const navigationModule = (pathname = '/settings/edit_users') => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => adminEnv.calls.push(['router.refresh']) }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
})

/**
 * `next/dynamic`: the only dynamic import on these pages is TaskFiles' uploader
 * (`ssr: false`). The loader starts at module evaluation and has resolved by the
 * time a page renders, so the uploader's chrome is part of every render.
 */
export const nextDynamicModule = async () => {
  const { createElement } = await import('react')
  return {
    default: (loader: () => Promise<{ default: (p: unknown) => unknown }>) => {
      let C: ((p: unknown) => unknown) | null = null
      void loader().then((m) => (C = m.default))
      return function Dynamic(props: Record<string, unknown>) {
        return C ? createElement(C as never, props) : null
      }
    },
  }
}

/** `@/lib/toast`: the real module (I18nProvider pushes its defaults), toasts recorded in `adminEnv.calls`. */
export const toastModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
  toast: (...args: unknown[]) => adminEnv.calls.push(['toast', ...args]),
  proToast: (...args: unknown[]) => adminEnv.calls.push(['proToast', ...args]),
})
