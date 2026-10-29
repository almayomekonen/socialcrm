import { vi } from 'vitest'
import { commentsEnv, messengerEnv } from './messengerCommentsEnv'

/**
 * Module doubles behind every `/inbox/messenger` and `/inbox/comments` i18n test.
 * The `vi.mock` calls live in each test file (they are hoisted per file); each
 * returns the matching factory below. Only I/O is replaced — db reads, server
 * actions, Meta calls, flags, toasts. Pages, components and label producers are
 * the REAL ones.
 */
export const mcSpies = {
  /** Which page's `facebook_pages` rows the shared db double returns. */
  route: 'messenger' as 'messenger' | 'comments',
  toasts: [] as unknown[][],
  replaces: [] as string[],
  pushes: [] as string[],
  refreshes: 0,
  sendReply: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  sendSaved: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true })),
  typing: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  markRead: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  loadOlder: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true, messages: [], hasMore: false })),
  createLead: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true, leadId: 90 })),
  linkLead: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true, leadId: 55 })),
  importHistory: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ conversations: 3, messages: 12, hasMore: false })),
  convert: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true, leadId: 70, created: true })),
  reply: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ ok: true, replyId: 'new1' })),
  loadMore: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ items: [], replies: [], posts: [], nextCursor: null })),
}

export function resetMcSpies() {
  mcSpies.route = 'messenger'
  mcSpies.toasts.length = 0
  mcSpies.replaces.length = 0
  mcSpies.pushes.length = 0
  mcSpies.refreshes = 0
  for (const v of Object.values(mcSpies)) {
    if (typeof v === 'function' && 'mockClear' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
  mcSpies.sendReply.mockImplementation(async () => ({ ok: true }))
  mcSpies.sendSaved.mockImplementation(async () => ({ ok: true }))
  mcSpies.typing.mockImplementation(async () => ({ ok: true }))
  mcSpies.markRead.mockImplementation(async () => ({ ok: true }))
  mcSpies.loadOlder.mockImplementation(async () => ({ ok: true, messages: [], hasMore: false }))
  mcSpies.createLead.mockImplementation(async () => ({ ok: true, leadId: 90 }))
  mcSpies.linkLead.mockImplementation(async () => ({ ok: true, leadId: 55 }))
  mcSpies.importHistory.mockImplementation(async () => ({ conversations: 3, messages: 12, hasMore: false }))
  mcSpies.convert.mockImplementation(async () => ({ ok: true, leadId: 70, created: true }))
  mcSpies.reply.mockImplementation(async () => ({ ok: true, replyId: 'new1' }))
  mcSpies.loadMore.mockImplementation(async () => ({ items: [], replies: [], posts: [], nextCursor: null }))
}

export const navigationModule = () => ({
  useRouter: () => ({
    push: (to: string) => mcSpies.pushes.push(to),
    replace: (to: string) => mcSpies.replaces.push(to),
    refresh: () => {
      mcSpies.refreshes++
    },
  }),
  usePathname: () => (mcSpies.route === 'messenger' ? '/inbox/messenger' : '/inbox/comments'),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
})

export const deviceModule = () => ({
  isMobileRequest: async () => false,
  isMobileWorkspaceRequest: async () => (mcSpies.route === 'messenger' ? messengerEnv.mobile : commentsEnv.mobile),
  getInAppBrowser: async () => null,
})

/** `db('facebook_pages').where(…).select(…)` — the only direct read these pages make. */
export const dbModule = () => {
  const q = {
    where: () => q,
    whereIn: () => q,
    select: async () => structuredClone(mcSpies.route === 'messenger' ? messengerEnv.pages : commentsEnv.pages),
    first: async () => undefined,
  }
  return { db: () => q }
}

export const permissionsModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/facebook/permissions')>('@/lib/facebook/permissions')),
  isFacebookMessengerEnabledForAgency: () => messengerEnv.enabled,
  isFacebookCommentRepliesEnabledForAgency: () => commentsEnv.repliesEnabled,
})

export const capabilityModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/facebook/comments/capability')>('@/lib/facebook/comments/capability')),
  isFacebookCommentsEnabledForAgency: () => commentsEnv.enabled,
})

const selectedConversation = () => {
  const found = messengerEnv.conversations.find((c) => c.id === messengerEnv.selectedId)
  return found ? { ...structuredClone(found), ...messengerEnv.selectedOverrides } : null
}

export const messengerQueriesModule = () => ({
  listMessengerConversations: async (_a: number, _u: number, q = '') =>
    structuredClone(messengerEnv.conversations).filter((c) => !q || String(c.lastMessageText ?? '').includes(q) || String(c.customerName ?? '').includes(q)),
  getMessengerConversation: async () => selectedConversation(),
  listMessengerMessagePage: async () => ({ messages: structuredClone(messengerEnv.messages), hasMore: messengerEnv.hasMore }),
  listMessengerConversationEvents: async () => structuredClone(messengerEnv.events),
  countUnreadMessengerConversations: async () => 4,
})

export const savedRepliesModule = () => ({ listMessengerSavedReplies: async () => structuredClone(messengerEnv.savedReplies) })
export const deliveryModule = () => ({
  checkMessengerDelivery: async () => messengerEnv.delivery,
  pendingMessengerDeliveryChecks: async () => {},
})
export const profileModule = () => ({ refreshMessengerProfiles: async () => {} })
export const nextServerModule = () => ({ after: () => {} })

export const messengerActionsModule = () => ({
  sendMessengerReply: mcSpies.sendReply,
  sendMessengerSavedReply: mcSpies.sendSaved,
  sendMessengerTyping: mcSpies.typing,
  markMessengerConversationRead: mcSpies.markRead,
  loadOlderMessengerMessages: mcSpies.loadOlder,
})
export const messengerLeadActionsModule = () => ({
  createLeadFromMessengerConversation: mcSpies.createLead,
  linkMessengerConversationToLead: mcSpies.linkLead,
})
export const messengerProfileActionsModule = () => ({ importMessengerConversations: mcSpies.importHistory })

export const commentsQueriesModule = () => ({ countOpenComments: async () => commentsEnv.openCount })
export const feedModule = async () => ({
  ...(await vi.importActual<typeof import('@/modules/facebookComments/feed')>('@/modules/facebookComments/feed')),
  loadCommentsFeedPage: async () => ({
    items: structuredClone(commentsEnv.items),
    replies: structuredClone(commentsEnv.replies),
    posts: structuredClone(commentsEnv.posts),
    nextCursor: commentsEnv.nextCursor,
  }),
})
export const enrichModule = () => ({ refreshCommentContext: async () => {} })
export const commentsActionsModule = () => ({ convertCommentToLead: mcSpies.convert })
export const replyActionsModule = () => ({ replyToComment: mcSpies.reply })
export const listActionsModule = () => ({ loadMoreComments: mcSpies.loadMore })

export const toastModule = async () => ({
  ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')),
  toast: (...a: unknown[]) => mcSpies.toasts.push(a),
})

/**
 * An XMLHttpRequest double for the attachment upload: records what was sent and
 * answers as `respond` says. jsdom's own XHR would try the network.
 */
export const xhr = {
  sent: [] as Record<string, unknown>[],
  respond: { status: 200, body: { ok: true } as Record<string, unknown> | null, network: false },
}
export class FakeXhr {
  upload: { onprogress: ((e: unknown) => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  response: unknown = null
  responseType = ''
  url = ''
  open(_m: string, url: string) {
    this.url = url
  }
  abort() {
    this.onabort?.()
  }
  send(form: FormData) {
    xhr.sent.push({ url: this.url, ...Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : (v as File).name])) })
    queueMicrotask(() => {
      if (xhr.respond.network) return this.onerror?.()
      this.upload.onload?.()
      this.status = xhr.respond.status
      this.response = xhr.respond.body
      this.onload?.()
    })
  }
}
export function resetXhr() {
  xhr.sent.length = 0
  xhr.respond = { status: 200, body: { ok: true }, network: false }
}
