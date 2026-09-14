/**
 * graphClient — the token never reaches a URL, a response, or an error message.
 */
import { createHmac } from 'crypto'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.META_APP_SECRET = 'app-secret'
})

import { describeGraphError, graphRequest, parseGraphError, stripPagingUrls } from '@/lib/facebook/graphClient'

describe('graphRequest', () => {
  it('Bearer header + appsecret_proof; no access_token anywhere in the URL', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: '1' }) })) as unknown as typeof fetch
    await graphRequest({ path: '/me', token: 'TOKEN-1', query: { fields: 'id' }, fetchImpl })
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('TOKEN-1')
    expect(url).not.toContain('access_token')
    expect(new URL(url).searchParams.get('appsecret_proof')).toBe(createHmac('sha256', 'app-secret').update('TOKEN-1').digest('hex'))
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN-1')
  })

  it('refuses to put a token in the path or the query — a programming error, thrown loudly', async () => {
    await expect(graphRequest({ path: '/me?access_token=x', token: 't' })).rejects.toThrow('invalid_graph_path')
    await expect(graphRequest({ path: '/me', token: 't', query: { access_token: 'x' } })).rejects.toThrow('invalid_graph_query')
  })

  it('strips paging.next/previous (they embed the token) at every depth, keeps cursors', async () => {
    const body = {
      data: [{ comments: { data: [], paging: { cursors: { after: 'B' }, next: 'https://graph.facebook.com/x?access_token=SECRET' } } }],
      paging: { cursors: { before: 'A', after: 'B' }, next: 'https://graph.facebook.com/y?access_token=SECRET', previous: 'https://z?access_token=SECRET' },
    }
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch
    const result = await graphRequest({ path: '/me/accounts', token: 't', fetchImpl })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result).toMatchObject({ ok: true, data: { paging: { cursors: { before: 'A', after: 'B' } } } })
    expect(stripPagingUrls({ paging: 'not-an-object' })).toEqual({ paging: 'not-an-object' })
  })

  it('a Meta error becomes a typed, redacted error — never a throw', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 190, error_subcode: 463, type: 'OAuthException', message: 'bad token EAAGabcdefghijklmnopqrstuvwxyz0123 access_token=EAAsecret' } }),
    })) as unknown as typeof fetch
    const result = await graphRequest({ path: '/me', token: 't', fetchImpl })
    expect(result.ok).toBe(false)
    const error = (result as { error: ReturnType<typeof parseGraphError> }).error
    expect(error).toMatchObject({ kind: 'graph', status: 400, code: 190, subcode: 463 })
    expect(error.message).not.toContain('EAAGabcdefghijklmnopqrstuvwxyz0123')
    expect(error.message).not.toContain('EAAsecret')
    expect(describeGraphError(error)).toBe('kind=graph status=400 code=190 subcode=463')
  })

  it('network failure and timeout are typed too', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    expect(await graphRequest({ path: '/me', token: 't', fetchImpl: boom })).toMatchObject({ ok: false, error: { kind: 'network' } })
    const abort = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }) as unknown as typeof fetch
    expect(await graphRequest({ path: '/me', token: 't', fetchImpl: abort })).toMatchObject({ ok: false, error: { kind: 'timeout' } })
  })
})
