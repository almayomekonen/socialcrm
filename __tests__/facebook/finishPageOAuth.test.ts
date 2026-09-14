/**
 * The last step of the Page OAuth callback: reconnect this admin's Pages, or
 * hand the picker an encrypted Page list. Covers the reviewer's scenarios —
 * a second admin still gets the picker, activation keeps its path, a missing
 * SECRETS_ENC_KEY is a clear failure rather than a crash.
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@/lib/facebook/refreshConnectedPages', () => ({ refreshConnectedPages: h.refresh }))
vi.mock('@/db/auth', () => ({ decrypt: vi.fn() }))

import { featureFromState, finishPageOAuth } from '@/lib/facebook/finishPageOAuth'

const pages = [{ id: 'P1', name: 'Page', access_token: 'EAA-TOKEN' }]

function run(opts: { state: string; origin?: 'settings' | 'activation'; grantedScopes?: string[] }) {
  const cookieStore = { set: vi.fn() }
  const req = new NextRequest(`https://getsocialcrm.com/api/auth/facebook/callback?state=${opts.state}&code=c`)
  const failed = vi.fn((reason: string) => NextResponse.redirect(`https://getsocialcrm.com/settings/facebook?error=${reason}`))
  const promise = finishPageOAuth({
    req,
    cookieStore,
    user: { id: 7, agencyId: 103 },
    origin: opts.origin ?? 'settings',
    pages,
    grantedScopes: opts.grantedScopes ?? ['leads_retrieval'],
    failed,
  })
  return { promise, cookieStore, failed }
}

beforeEach(() => {
  process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 6).toString('base64')
  h.refresh.mockReset()
})

describe('finishPageOAuth', () => {
  it('reconnect of this admin\'s own Page: refreshed server-side, no picker cookie, success notice', async () => {
    h.refresh.mockResolvedValue({ refreshed: 1, subscribeFailed: 0 })
    const { promise, cookieStore } = run({ state: 'settings.uuid' })
    const res = await promise
    expect(h.refresh).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 103, userId: 7 }))
    expect(res.headers.get('location')).toContain('/settings/facebook?reconnected=1')
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it('nothing of THIS admin\'s refreshed (first connection, or a colleague\'s Page): the picker gets an encrypted list', async () => {
    h.refresh.mockResolvedValue({ refreshed: 0, subscribeFailed: 0 })
    const { promise, cookieStore } = run({ state: 'settings.uuid' })
    const res = await promise
    expect(res.headers.get('location')).toContain('/settings/facebook?select=1')
    const [name, value] = cookieStore.set.mock.calls[0]
    expect(name).toBe('fb_pages')
    expect(String(value).startsWith('scmp1.')).toBe(true)
    expect(String(value)).not.toContain('EAA-TOKEN')
  })

  it('activation never takes the reconnect shortcut', async () => {
    const { promise } = run({ state: 'activation.uuid', origin: 'activation' })
    const res = await promise
    expect(h.refresh).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toContain('/activate?activation=select')
  })

  it('a feature request returns to the surface that asked, saying whether the permission was granted', async () => {
    h.refresh.mockResolvedValue({ refreshed: 1, subscribeFailed: 0 })
    const granted = await run({ state: 'settings.messenger.uuid', grantedScopes: ['pages_messaging', 'pages_manage_metadata', 'pages_show_list'] }).promise
    expect(granted.headers.get('location')).toContain('/inbox/messenger?permission=granted')
    const missing = await run({ state: 'settings.comment_replies.uuid', grantedScopes: ['pages_show_list'] }).promise
    expect(missing.headers.get('location')).toContain('/inbox/comments?permission=missing')
  })

  it('SECRETS_ENC_KEY missing → a clear save_failed notice, not an unhandled 500', async () => {
    delete process.env.SECRETS_ENC_KEY
    h.refresh.mockResolvedValue({ refreshed: 0, subscribeFailed: 0 })
    const { promise, failed, cookieStore } = run({ state: 'settings.uuid' })
    await promise
    expect(failed).toHaveBeenCalledWith('save_failed')
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it('feature parsing reads only known features from the state', () => {
    expect(featureFromState('settings.messenger.abc')).toBe('messenger')
    expect(featureFromState('settings.ads_management.abc')).toBeNull()
    expect(featureFromState('settings.abc')).toBeNull()
    expect(featureFromState(null)).toBeNull()
  })
})
