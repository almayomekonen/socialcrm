import { vi } from 'vitest'
import { questionnaireEnv } from './questionnaireEnv'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { previewDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'

/**
 * `vi.mock` factories for the questionnaire builder (Phase E5c). I/O only: the
 * page, the editor, the Flow view, the preview (production renderer), the
 * publish check's problems and the test chat (the production simulator, run on
 * the draft being edited) run for real. Each action records its arguments in
 * `questionnaireEnv.calls` and answers `questionnaireEnv.results[name]` when set
 * (`'throw'` → it throws), else its success shape.
 */

function record<T>(name: string, success: (...args: unknown[]) => T) {
  return async (...args: unknown[]) => {
    questionnaireEnv.calls.push([name, ...structuredClone(args)])
    const r = questionnaireEnv.results[name]
    if (r === 'throw') throw new Error(`${name} failed`)
    return structuredClone(r === undefined ? success(...args) : r) as T
  }
}

// ── session, access, flags ─────────────────────────────────────────────────
export const authModule = () => ({ getUser: async () => questionnaireEnv.user, isUserExists: async () => null })
export const requireUserModule = async () => {
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  return {
    ...actual,
    requireAgencyUser: async () => questionnaireEnv.user,
    requireUser: async () => questionnaireEnv.user,
    requireProductAccess: async () => {
      if (!questionnaireEnv.hasAccess) throw new actual.ProductAccessError('subscription-required' as never)
      return questionnaireEnv.user
    },
  }
}
export const deviceModule = () => ({ isMobileRequest: async () => questionnaireEnv.mobile, isMobileWorkspaceRequest: async () => questionnaireEnv.mobile, getInAppBrowser: async () => null })
export const builderFlagsModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/flags/questionnaireBuilderFlags')>('@/lib/flags/questionnaireBuilderFlags')),
  canUseQuestionnaireBuilder: () => questionnaireEnv.builder,
  canUseQuestionnaireFlowEditor: () => questionnaireEnv.flow,
})
export const naturalAnswersFlagsModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/flags/whatsappQuestionnaireFlags')>('@/lib/flags/whatsappQuestionnaireFlags')),
  canUseQuestionnaireNaturalAnswers: () => questionnaireEnv.allowAll,
})

// ── server reads ───────────────────────────────────────────────────────────
export const serviceModule = () => ({ getBuilderState: async () => structuredClone(questionnaireEnv.state) })

// ── actions ────────────────────────────────────────────────────────────────
const draft = () => questionnaireEnv.state.draft ?? questionnaireEnv.state.published
export const draftActionsModule = () => ({
  openQuestionnaireDraft: record('openQuestionnaireDraft', () => {
    const d = questionnaireEnv.state.draft
    return d ? { ok: true, ...d, draftId: d.draftId + 1, draftVersion: 1 } : { ok: false, reason: 'forbidden' }
  }),
  saveQuestionnaireDraft: record('saveQuestionnaireDraft', (input) => ({ ok: true, draftVersion: ((input as { expectedVersion: number }).expectedVersion ?? 0) + 1, assigned: {} })),
  checkQuestionnaireDraft: record('checkQuestionnaireDraft', () => ({ ok: true, ready: true, issues: [] })),
  discardQuestionnaireDraft: record('discardQuestionnaireDraft', () => ({ ok: true })),
})

/** The test chat answers with the PRODUCTION simulator, on the draft as last saved (the latest `saveQuestionnaireDraft` call). */
async function simulate(input: unknown) {
  const saves = questionnaireEnv.calls.filter((c) => c[0] === 'saveQuestionnaireDraft')
  const last = saves.length ? (saves[saves.length - 1][1] as { questionnaire: never }).questionnaire : (draft()?.questionnaire as never)
  return { ok: true, ...simulateConversation(previewDefinition(last)!, (input as { turns: string[][] }).turns) }
}
export const publishActionsModule = () => ({
  simulateQuestionnaireDraft: async (input: unknown) => {
    questionnaireEnv.calls.push(['simulateQuestionnaireDraft', structuredClone(input)])
    const r = questionnaireEnv.results.simulateQuestionnaireDraft
    if (r === 'throw') throw new Error('simulate failed')
    return r === undefined ? simulate(input) : structuredClone(r)
  },
  publishQuestionnaireDraft: record('publishQuestionnaireDraft', () => ({ ok: true, revision: 3 })),
  listQuestionnaireRevisions: record('listQuestionnaireRevisions', () => ({ ok: true, revisions: questionnaireEnv.revisions })),
})

/** `next/navigation`: notFound / redirect throw, router calls recorded. */
export const navigationModule = () => ({
  usePathname: () => '/settings/questionnaire',
  useRouter: () => ({ push: (to: string) => questionnaireEnv.calls.push(['router.push', to]), replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
})

/** `@/lib/toast`: the real module (I18nProvider pushes its defaults), toasts recorded. */
export const toastModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
  toast: (...args: unknown[]) => questionnaireEnv.calls.push(['toast', ...args.filter((a) => typeof a !== 'function')]),
  proToast: (...args: unknown[]) => questionnaireEnv.calls.push(['proToast', ...args]),
})
