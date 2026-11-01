import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { inboxShell } from './inboxHarness'
import { ACTIVE, COMMENTS_DEFAULTS, MESSENGER_DEFAULTS, commentsEnv, messengerEnv } from './messengerCommentsEnv'
import { mcSpies } from './messengerCommentsMocks'

/**
 * Renders `/inbox/messenger` and `/inbox/comments` the way the (app) layout
 * does: the interface-language provider, the entitlement state and the session
 * user (inboxHarness's `inboxShell`) around the REAL server page, async server
 * components resolved in place. The mocks for their I/O live in each test file
 * (factories in messengerCommentsMocks.ts).
 */

type Ent = typeof ACTIVE

export async function messengerPage(searchParams: Record<string, string> = {}) {
  mcSpies.route = 'messenger'
  const { default: Page } = await import('@/app/(he)/(app)/inbox/messenger/page')
  const sp = messengerEnv.selectedId ? { c: String(messengerEnv.selectedId), ...searchParams } : searchParams
  return resolveAsync(await Page({ searchParams: Promise.resolve(sp) }))
}

export async function commentsPage(searchParams: Record<string, string> = {}) {
  mcSpies.route = 'comments'
  const { default: Page } = await import('@/app/(he)/(app)/inbox/comments/page')
  return resolveAsync(await Page({ searchParams: Promise.resolve(searchParams) }))
}

/** Build under `overrides`, then restore the defaults other renders expect. */
export async function withMessenger<T>(overrides: Partial<typeof MESSENGER_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(messengerEnv, MESSENGER_DEFAULTS, overrides)
  try {
    return await build()
  } finally {
    Object.assign(messengerEnv, MESSENGER_DEFAULTS)
  }
}
export async function withComments<T>(overrides: Partial<typeof COMMENTS_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(commentsEnv, COMMENTS_DEFAULTS, overrides)
  try {
    return await build()
  } finally {
    Object.assign(commentsEnv, COMMENTS_DEFAULTS)
  }
}

/** The page under the layout's providers (`null` locale: no provider, the Hebrew baseline). */
export const messengerScreen = async (
  locale: UiLocale | null,
  overrides: Partial<typeof MESSENGER_DEFAULTS> = {},
  searchParams: Record<string, string> = {},
  ent?: Ent,
) => inboxShell(locale, await withMessenger(overrides, () => messengerPage(searchParams)), ent)

export const commentsScreen = async (
  locale: UiLocale | null,
  overrides: Partial<typeof COMMENTS_DEFAULTS> = {},
  searchParams: Record<string, string> = {},
  ent?: Ent,
) => inboxShell(locale, await withComments(overrides, () => commentsPage(searchParams)), ent)

export async function routeChrome(route: 'messenger' | 'comments') {
  if (route === 'messenger') {
    const { default: Loading } = await import('@/app/(he)/(app)/inbox/messenger/loading')
    const { default: ErrorBoundary } = await import('@/app/(he)/(app)/inbox/messenger/error')
    return { Loading, ErrorBoundary }
  }
  const { default: Loading } = await import('@/app/(he)/(app)/inbox/comments/loading')
  const { default: ErrorBoundary } = await import('@/app/(he)/(app)/inbox/comments/error')
  return { Loading, ErrorBoundary }
}
