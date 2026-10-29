import { vi } from 'vitest'
import { inboxEnv, INBOX_USER, OPERATOR_TAKE, intelView } from './inboxEnv'

/**
 * Module doubles behind every `/inbox` i18n test. The `vi.mock` calls must live
 * in each test file (they are hoisted per file); each one returns the matching
 * factory below, so all the files mock the same I/O the same way. Only I/O is
 * replaced — db reads, server actions, flags, toasts. Components, label
 * producers and the row mapper are the REAL ones.
 */
export const inboxSpies = {
  prefs: { userLocale: null as string | null },
  toasts: [] as unknown[][],
  replaces: [] as string[],
  refreshes: 0,
  loadMore: vi.fn(async (..._a: unknown[]) => ({ items: [], nextCursor: null })),
  markRead: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  deleteConversation: vi.fn(async (..._a: unknown[]) => ({ ok: true, deleted: true })),
  signalTyping: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  sendReply: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  generateDraft: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true, message: 'טיוטה מה-AI' })),
  takeOver: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  returnToAgent: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  promote: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  listMatches: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true, matches: [] })),
  link: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  markPersonal: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  sendTemplate: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  operatorEvents: [] as unknown[][],
}

export function resetInboxSpies() {
  inboxSpies.prefs.userLocale = null
  inboxSpies.toasts.length = 0
  inboxSpies.replaces.length = 0
  inboxSpies.refreshes = 0
  inboxSpies.operatorEvents.length = 0
  for (const v of Object.values(inboxSpies)) {
    if (typeof v === 'function' && 'mockClear' in v) (v as ReturnType<typeof vi.fn>).mockClear()
  }
}

export const navigationModule = () => ({
  useRouter: () => ({
    push: () => {},
    replace: (to: string) => inboxSpies.replaces.push(to),
    refresh: () => {
      inboxSpies.refreshes++
    },
  }),
  usePathname: () => '/inbox',
  useSearchParams: () => new URLSearchParams(inboxEnv.search),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
})

export const cacheModule = () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  cacheTag: () => {},
  unstable_cache: (fn: unknown) => fn,
})

export const queriesModule = async () => {
  const { mapInboxRow } = await import('@/modules/inbox/mapInboxRow')
  const { NOW } = await import('./inboxEnv')
  return {
    listInboxConversations: async () => ({ items: inboxEnv.rows.map((r) => mapInboxRow(r, NOW)), nextCursor: null }),
    getInboxSmartCounts: async () => inboxEnv.smartCounts,
    getInboxConversationById: async () => inboxEnv.selected,
    getInboxConversationByLeadId: async () => null,
  }
}

export const inboxActionsModule = () => ({
  loadMoreInboxConversations: inboxSpies.loadMore,
  markConversationRead: inboxSpies.markRead,
  deleteConversation: inboxSpies.deleteConversation,
  signalHumanTyping: inboxSpies.signalTyping,
  resolveLeadWhatsappConversation: async () => ({ conversationId: null }),
})

const ownershipState = () => {
  const o = inboxEnv.ownership
  if (o === 'off' || o === 'paused') return null
  if (o === 'silent') return { agencyId: 103, aiState: 'ai_qualifying', aiTurnCount: 0 }
  const aiState = o === 'agent' || o === 'questionnaire' ? 'ai_qualifying' : o === 'handoff' ? 'escalated' : 'human_active'
  return { agencyId: 103, aiState, aiTurnCount: 3 }
}

export const autoResponseSettingsModule = () => ({
  getMasterEnabled: async () => inboxEnv.ownership !== 'off',
  getChannelSettings: async () =>
    inboxEnv.ownership === 'off'
      ? null
      : { enabled: true, responder: inboxEnv.ownership.startsWith('questionnaire') ? 'questionnaire' : 'agent' },
})

export const aiStateModule = () => ({ getAiState: async () => ownershipState() })

export const questionnaireSessionsModule = () => ({
  readSessionForConversation: async () =>
    inboxEnv.ownership === 'questionnaire'
      ? { status: 'active' }
      : inboxEnv.ownership === 'questionnaireEnded'
        ? { status: 'completed' }
        : null,
})

export const replyEntitlementModule = () => ({
  aiRepliesPausedForPlan: async () => inboxEnv.ownership === 'paused',
})

export const conversationIntelligenceModule = () => ({
  INTEL_KIND_SUMMARY: 'summary',
  INTEL_KIND_INTENT: 'intent',
  INTEL_KIND_TEMPERATURE: 'temperature',
  INTEL_KIND_ACTION: 'suggested_action',
  conversationIntelligenceTag: (id: number) => `conv-intel:${id}`,
  getConversationIntelligence: async () => intelView(inboxEnv.intel),
  getHandoffSummary: async () => inboxEnv.handoff,
  getOperatorTakeData: async () => inboxEnv.operatorTake ?? null,
})

export const ownershipActionsModule = () => ({
  takeOverConversation: inboxSpies.takeOver,
  returnToAgent: inboxSpies.returnToAgent,
})

export const promoteActionsModule = () => ({
  promoteConversationToLead: inboxSpies.promote,
  listConversationLeadMatches: inboxSpies.listMatches,
  linkConversationToExistingLead: inboxSpies.link,
})

export const leadIntelligenceModule = async () => {
  const { INTELLIGENCE } = await import('./leadDetailEnv')
  return { getLeadIntelligence: async () => ({ ok: true, data: INTELLIGENCE }) }
}

export const toastModule = () => ({
  toast: (...a: unknown[]) => inboxSpies.toasts.push(a),
  proToast: (opts: unknown) => inboxSpies.toasts.push(['pro', opts]),
})

export { INBOX_USER, OPERATOR_TAKE }
