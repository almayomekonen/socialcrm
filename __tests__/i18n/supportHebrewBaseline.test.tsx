// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import type { ReactNode } from 'react'
import { NOW, requestRow, resetTrialSupportEnv, trialSupportEnv as env } from './trialSupportEnv'
import { resolveAsync } from './dashboardHarness'

/**
 * HEBREW BASELINE, part 1 (i18n Phase F5): the REAL support-centre pages —
 * the `(support)` layout + shell (named / nameless user), `/support` (with and
 * without requests), `/support/requests` (populated / empty), `/support/new`
 * (problem / question / unknown kind), a thread (every status, a colleague's
 * request, the resolved reopen note), `/support/guides` (categories, results,
 * no results), every guide article, an unknown slug, every page's metadata,
 * plus a JSON snapshot of the copy producers. Recorded BEFORE Phase F5; Hebrew
 * must match byte-for-byte afterwards. Interactions: …Interactions.test.tsx.
 *
 * No i18n provider, no stored preference. Normalized: React's `<!-- -->` only.
 */

vi.mock('next/navigation', async () => (await import('./trialSupportMocks')).navigationModule())
vi.mock('@/db/auth', async () => (await import('./trialSupportMocks')).authDbModule())
vi.mock('@/lib/requireUser', async () => (await import('./trialSupportMocks')).requireUserModule())
vi.mock('@/db/uiLocale', async () => (await import('./trialSupportMocks')).uiLocaleDbModule())
vi.mock('@/db/support/requests', async () => (await import('./trialSupportMocks')).supportRequestsDbModule())
vi.mock('@/db/support/messages', async () => (await import('./trialSupportMocks')).supportMessagesDbModule())
vi.mock('@/actions/support/requests', async () => (await import('./trialSupportMocks')).supportActionsModule())
vi.mock('@/lib/toast', async () => (await import('./trialSupportMocks')).toastModule())

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')
const html = async (node: unknown) => renderToString((await resolveAsync(node as ReactNode)) as ReactNode)

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(resetTrialSupportEnv)

async function layout(child: ReactNode = <h1>x</h1>) {
  const { default: Layout } = await import('@/app/(support)/layout')
  return html(Layout({ children: child }))
}

async function threadPage(id = '41') {
  const { default: Page } = await import('@/app/(support)/support/requests/[requestId]/page')
  return html(await Page({ params: Promise.resolve({ requestId: id }) }))
}

describe('Hebrew baseline — support shell and landing', () => {
  test('layout: named user, nameless user', async () => {
    expect(await layout()).toMatchSnapshot('layout — named')
    env.user = { ...env.user, name: null, firstName: null, lastName: null, gglName: null, email: null }
    expect(await layout()).toMatchSnapshot('layout — nameless')
  })

  test('/support with requests, without requests', async () => {
    const { default: Page } = await import('@/app/(support)/support/page')
    expect(await html(Page())).toMatchSnapshot('/support — with requests')
    env.requests = []
    expect(await html(Page())).toMatchSnapshot('/support — no requests')
  })

  test('/support/requests populated, empty', async () => {
    const { default: Page } = await import('@/app/(support)/support/requests/page')
    expect(await html(Page())).toMatchSnapshot('/support/requests — populated')
    env.requests = []
    expect(await html(Page())).toMatchSnapshot('/support/requests — empty')
  })

  test('/support/new for every kind', async () => {
    const { default: Page } = await import('@/app/(support)/support/new/page')
    for (const kind of ['problem', 'question', 'nonsense', undefined]) {
      const out = await html(await Page({ searchParams: Promise.resolve(kind ? { kind } : {}) }))
      expect(out).toMatchSnapshot(`/support/new — ${kind ?? 'none'}`)
    }
  })
})

describe('Hebrew baseline — a support thread', () => {
  test('every status; resolved shows the reopen note', async () => {
    for (const status of ['open', 'in_progress', 'waiting_for_customer', 'resolved']) {
      env.request = requestRow({ status })
      expect(await threadPage()).toMatchSnapshot(`thread — ${status}`)
    }
  })

  test("an admin reading a colleague's request; not found; invalid id", async () => {
    env.request = requestRow({ createdByUserId: 9, requesterNameSnapshot: 'יוסי לוי' })
    env.messages = env.messages.map((m) => ({ ...m, authorUserId: m.authorKind === 'customer' ? 9 : m.authorUserId }))
    expect(await threadPage()).toMatchSnapshot('thread — colleague')
    env.request = null
    await expect(threadPage()).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(threadPage('abc')).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('Hebrew baseline — guides', () => {
  test('/support/guides: categories, results, no results', async () => {
    const { default: Page } = await import('@/app/(support)/support/guides/page')
    for (const q of [undefined, 'whatsapp', 'לידים', 'zzzz']) {
      const out = await html(await Page({ searchParams: Promise.resolve(q ? { q } : {}) }))
      expect(out).toMatchSnapshot(`/support/guides — ${q ?? 'categories'}`)
    }
  })

  test('every guide article; unknown slug', async () => {
    const { GUIDE_ARTICLES } = await import('@/lib/support/knowledgeBase')
    const { default: Page } = await import('@/app/(support)/support/guides/[slug]/page')
    for (const a of GUIDE_ARTICLES) {
      expect(await html(await Page({ params: Promise.resolve({ slug: a.slug }) }))).toMatchSnapshot(`article — ${a.slug}`)
    }
    await expect(Page({ params: Promise.resolve({ slug: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('Hebrew baseline — metadata and producers', () => {
  test('every page title', async () => {
    const titles: Record<string, unknown> = {}
    const of = async (mod: { metadata?: unknown; generateMetadata?: (a?: unknown) => Promise<unknown> }, arg?: unknown) =>
      mod.generateMetadata ? await mod.generateMetadata(arg) : mod.metadata
    titles.support = await of(await import('@/app/(support)/support/page'))
    titles.requests = await of(await import('@/app/(support)/support/requests/page'))
    titles.new = await of(await import('@/app/(support)/support/new/page'))
    titles.guides = await of(await import('@/app/(support)/support/guides/page'))
    const article = await import('@/app/(support)/support/guides/[slug]/page')
    titles.article = await of(article, { params: Promise.resolve({ slug: 'connect-whatsapp' }) })
    titles.articleUnknown = await of(article, { params: Promise.resolve({ slug: 'nope' }) })
    const thread = await import('@/app/(support)/support/requests/[requestId]/page')
    titles.thread = await of(thread as never, { params: Promise.resolve({ requestId: '41' }) })
    expect(titles).toMatchSnapshot()
  })

  test('copy producers (JSON)', async () => {
    const copy = await import('@/lib/support/copy')
    const { toThreadMessages, toRequestSummaries } = await import('@/lib/support/presenters')
    const { timeAgo } = await import('@/components/settings/connections/copy')
    const { searchArticles } = await import('@/lib/support/knowledgeBase')
    const codes = ['forbidden', 'not_found', 'invalid_subject', 'invalid_body', 'invalid_category', 'rate_limited', 'unknown'] as const
    const ago = [0, 0.5, 1, 59, 60, 23 * 60, 24 * 60, 47 * 60, 48 * 60].map((m) => timeAgo(new Date(NOW.getTime() - m * 60_000).toISOString()))
    expect(
      JSON.stringify(
        {
          STATUS_COPY: copy.STATUS_COPY,
          CATEGORY_COPY: copy.CATEGORY_COPY,
          KIND_COPY: copy.KIND_COPY,
          AUTHOR_LABEL: copy.AUTHOR_LABEL,
          errors: codes.map((c) => copy.supportErrorMessage(c as never)),
          thread: toThreadMessages(env.messages as never, 7, 'יוסי לוי'),
          threadNoName: toThreadMessages(env.messages as never, 8),
          summaries: toRequestSummaries(env.requests as never, 7),
          ago,
          search: ['whatsapp', 'וואטסאפ', 'Excel', 'מנוי', 'pro', ' ', 'zz'].map((q) => searchArticles(q).map((a) => a.slug)),
        },
        null,
        2,
      ),
    ).toMatchSnapshot()
  })
})
