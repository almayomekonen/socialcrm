import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveClient, trustedClientHosts, __resetCimdCacheForTests } from '@/lib/oauth/server/cimd'

const ID = 'https://chatgpt.com/oauth/client.json'
const DOC = {
  client_id: ID,
  client_name: 'ChatGPT',
  redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
const hop = (to: string) => new Response(null, { status: 302, headers: { location: to } })
const streamOf = (chunks: string[], { close = true } = {}) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch))
      if (close) c.close()
    },
  })
const deps = (fetch: FetchFn, extra: Record<string, unknown> = {}) => ({ fetch, trustedHosts: ['chatgpt.com'], ...extra })
const fetched = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => c[0] as string)

beforeEach(() => __resetCimdCacheForTests())

describe('CIMD resolver — happy path', () => {
  it('resolves an allowlisted document with a safe fetch configuration', async () => {
    const f = vi.fn(async () => json(DOC))
    const r = await resolveClient(ID, deps(f))
    expect(r).toEqual({ ok: true, client: { clientId: ID, clientName: 'ChatGPT', redirectUris: DOC.redirect_uris } })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(ID)
    expect(init.redirect).toBe('manual')
    expect(init.credentials).toBe('omit')
    expect(init.method).toBe('GET')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("accepts ChatGPT's published document verbatim (captured 2026-10-03)", async () => {
    // Exact body of GET https://chatgpt.com/oauth/client.json (200, application/json,
    // cache-control: public, max-age=300). Extra fields must be ignored, and the
    // supported-methods list (not the single default method) decides the intersection.
    const real = {
      client_id: 'https://chatgpt.com/oauth/client.json',
      client_uri: 'https://chatgpt.com/',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'ChatGPT',
      logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
      token_endpoint_auth_signing_alg: 'RS256',
      jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
    }
    const f = vi.fn(async () =>
      json(real, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }),
    )
    expect(await resolveClient(ID, deps(f))).toEqual({
      ok: true,
      client: { clientId: ID, clientName: 'ChatGPT', redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'] },
    })
  })

  it('accepts a single token_endpoint_auth_method of none', async () => {
    const { token_endpoint_auth_methods_supported: _omit, ...rest } = DOC
    const f = vi.fn(async () => json({ ...rest, token_endpoint_auth_method: 'none' }))
    expect((await resolveClient(ID, deps(f))).ok).toBe(true)
  })

  it('accepts application/json with parameters and +json media types', async () => {
    for (const ct of ['application/json; charset=utf-8', 'application/oauth-client-metadata+json']) {
      __resetCimdCacheForTests()
      const f = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200, headers: { 'content-type': ct } }))
      expect((await resolveClient(ID, deps(f))).ok, ct).toBe(true)
    }
  })

  it('reads the trusted host list from env, defaulting to chatgpt.com, and drops IP/loopback entries', () => {
    expect(trustedClientHosts({} as NodeJS.ProcessEnv)).toEqual(['chatgpt.com'])
    expect(
      trustedClientHosts({ MCP_TRUSTED_CLIENT_ID_HOSTS: ' ChatGPT.com , example.org ' } as unknown as NodeJS.ProcessEnv),
    ).toEqual(['chatgpt.com', 'example.org'])
    expect(
      trustedClientHosts({
        MCP_TRUSTED_CLIENT_ID_HOSTS: '127.0.0.1, localhost, 10.0.0.5, chatgpt.com',
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual(['chatgpt.com'])
  })
})

describe('CIMD resolver — client_id URL policy (no fetch on rejection)', () => {
  it.each([
    ['http scheme', 'http://chatgpt.com/oauth/client.json'],
    ['other scheme', 'ftp://chatgpt.com/oauth/client.json'],
    ['untrusted host', 'https://evil.com/oauth/client.json'],
    ['suffix look-alike', 'https://chatgpt.com.evil.com/oauth/client.json'],
    ['prefix look-alike', 'https://evilchatgpt.com/oauth/client.json'],
    ['subdomain (exact match only)', 'https://api.chatgpt.com/oauth/client.json'],
    ['trailing-dot host', 'https://chatgpt.com./oauth/client.json'],
    ['uppercase host (not canonical)', 'https://ChatGPT.com/oauth/client.json'],
    ['userinfo', 'https://user:pw@chatgpt.com/oauth/client.json'],
    ['user only', 'https://evil.com@chatgpt.com/oauth/client.json'],
    ['explicit default port', 'https://chatgpt.com:443/oauth/client.json'],
    ['other port', 'https://chatgpt.com:8443/oauth/client.json'],
    ['root path', 'https://chatgpt.com/'],
    ['no path', 'https://chatgpt.com'],
    ['query', 'https://chatgpt.com/oauth/client.json?x=1'],
    ['empty query', 'https://chatgpt.com/oauth/client.json?'],
    ['fragment', 'https://chatgpt.com/oauth/client.json#x'],
    ['dot segment', 'https://chatgpt.com/oauth/../oauth/client.json'],
    ['backslash', 'https://chatgpt.com\\oauth\\client.json'],
    ['whitespace', ' https://chatgpt.com/oauth/client.json'],
    ['IPv4 literal', 'https://127.0.0.1/oauth/client.json'],
    ['IPv6 literal', 'https://[::1]/oauth/client.json'],
    ['localhost', 'https://localhost/oauth/client.json'],
    ['malformed', 'not a url'],
    ['empty', ''],
  ])('rejects %s without fetching', async (_n, id) => {
    const f = vi.fn()
    expect(await resolveClient(id, deps(f))).toEqual({ ok: false, reason: 'client_id_not_allowed' })
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects an IP or loopback client_id even if it is put on the allowlist', async () => {
    const f = vi.fn()
    for (const [host, id] of [
      ['127.0.0.1', 'https://127.0.0.1/c.json'],
      ['localhost', 'https://localhost/c.json'],
    ]) {
      expect(await resolveClient(id, { fetch: f, trustedHosts: [host] })).toEqual({ ok: false, reason: 'client_id_not_allowed' })
    }
    expect(f).not.toHaveBeenCalled()
  })
})

describe('CIMD resolver — redirects', () => {
  it('follows an absolute redirect to an allowlisted https host', async () => {
    const f = vi.fn().mockResolvedValueOnce(hop('https://chatgpt.com/oauth/client-v2.json')).mockResolvedValueOnce(json(DOC))
    expect((await resolveClient(ID, deps(f))).ok).toBe(true)
    expect(fetched(f)).toEqual([ID, 'https://chatgpt.com/oauth/client-v2.json'])
  })

  it('resolves a relative Location against the current URL, then applies the same policy', async () => {
    const f = vi.fn().mockResolvedValueOnce(hop('/oauth/v2/client.json')).mockResolvedValueOnce(json(DOC))
    expect((await resolveClient(ID, deps(f))).ok).toBe(true)
    expect(fetched(f)[1]).toBe('https://chatgpt.com/oauth/v2/client.json')
  })

  it.each([
    ['untrusted host', 'https://evil.com/c.json'],
    ['look-alike host', 'https://chatgpt.com.evil.com/c.json'],
    ['protocol-relative to untrusted host', '//evil.com/c.json'],
    ['http downgrade', 'http://chatgpt.com/oauth/client.json'],
    ['explicit port', 'https://chatgpt.com:8443/oauth/client.json'],
    ['explicit default port', 'https://chatgpt.com:443/oauth/client.json'],
    ['userinfo', 'https://a:b@chatgpt.com/oauth/client.json'],
    ['IP literal', 'https://169.254.169.254/latest/meta-data'],
    ['alternate protocol', 'file:///etc/passwd'],
    ['query', 'https://chatgpt.com/oauth/client.json?x=1'],
    ['root path', 'https://chatgpt.com/'],
  ])('a redirect to %s fails before any request is sent there', async (_n, to) => {
    const f = vi.fn().mockResolvedValueOnce(hop(to))
    expect(await resolveClient(ID, deps(f))).toEqual({ ok: false, reason: 'redirect_not_allowed' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('a 3xx without a Location fails closed', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302 }))
    expect(await resolveClient(ID, deps(f))).toEqual({ ok: false, reason: 'redirect_not_allowed' })
  })

  it('follows at most two redirects', async () => {
    const two = vi
      .fn()
      .mockResolvedValueOnce(hop('https://chatgpt.com/a.json'))
      .mockResolvedValueOnce(hop('https://chatgpt.com/b.json'))
      .mockResolvedValueOnce(json(DOC))
    expect((await resolveClient(ID, deps(two))).ok).toBe(true)

    __resetCimdCacheForTests()
    const loop = vi.fn().mockResolvedValue(hop('https://chatgpt.com/a.json'))
    expect(await resolveClient(ID, deps(loop))).toEqual({ ok: false, reason: 'too_many_redirects' })
    expect(loop).toHaveBeenCalledTimes(3)
  })
})

describe('CIMD resolver — network bounds', () => {
  it('fails closed on a network error', async () => {
    expect(
      await resolveClient(
        ID,
        deps(async () => {
          throw new Error('ECONNRESET')
        }),
      ),
    ).toEqual({ ok: false, reason: 'fetch_failed' })
  })

  it('times out a request that never answers', async () => {
    const hang: FetchFn = (_u, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    expect(await resolveClient(ID, deps(hang, { timeoutMs: 30 }))).toEqual({ ok: false, reason: 'fetch_failed' })
  })

  it('times out a body that never finishes', async () => {
    const f = vi.fn(
      async () =>
        new Response(streamOf(['{"client_id":'], { close: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    expect(await resolveClient(ID, deps(f, { timeoutMs: 30 }))).toEqual({ ok: false, reason: 'fetch_failed' })
  })

  it('uses one deadline for the whole resolution, not a fresh one per redirect', async () => {
    const signals: AbortSignal[] = []
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      return signals.length === 1 ? hop('https://chatgpt.com/b.json') : json(DOC)
    })
    await resolveClient(ID, deps(f))
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
  })

  it.each([404, 500, 204, 201])('fails closed on a final %s', async (status) => {
    const f = vi.fn(
      async () =>
        new Response(status === 204 ? null : JSON.stringify(DOC), { status, headers: { 'content-type': 'application/json' } }),
    )
    expect(await resolveClient(ID, deps(f))).toEqual({ ok: false, reason: 'fetch_failed' })
  })

  it('enforces the 64 KB cap when Content-Length is absent', async () => {
    const big = new Response(streamOf(['{"a":"', 'x'.repeat(70_000), '"}']), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    expect(
      await resolveClient(
        ID,
        deps(async () => big),
      ),
    ).toEqual({ ok: false, reason: 'too_large' })
  })

  it('enforces the cap when Content-Length lies (claims small, sends large)', async () => {
    const liar = new Response(streamOf(['{"a":"', 'x'.repeat(70_000), '"}']), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '20' },
    })
    expect(
      await resolveClient(
        ID,
        deps(async () => liar),
      ),
    ).toEqual({ ok: false, reason: 'too_large' })
  })

  it('rejects early when Content-Length declares more than the cap', async () => {
    const declared = new Response(streamOf(['{}']), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
    })
    expect(
      await resolveClient(
        ID,
        deps(async () => declared),
      ),
    ).toEqual({ ok: false, reason: 'too_large' })
  })

  it('stops reading once the cap is exceeded', async () => {
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++
        c.enqueue(new Uint8Array(16 * 1024))
      },
    })
    const r = new Response(endless, { status: 200, headers: { 'content-type': 'application/json' } })
    expect(
      await resolveClient(
        ID,
        deps(async () => r),
      ),
    ).toEqual({ ok: false, reason: 'too_large' })
    expect(pulled).toBeLessThan(10)
  })
})

describe('CIMD resolver — content validation', () => {
  const withDoc = (doc: unknown, ct = 'application/json') =>
    deps(
      async () =>
        new Response(typeof doc === 'string' ? doc : JSON.stringify(doc), { status: 200, headers: { 'content-type': ct } }),
    )

  it.each([
    ['text/html', '<html>'],
    ['text/plain', JSON.stringify(DOC)],
    ['application/jsonp', JSON.stringify(DOC)],
    ['text/json-ish', JSON.stringify(DOC)],
  ])('rejects content type %s', async (ct, body) => {
    expect(await resolveClient(ID, withDoc(body, ct))).toEqual({ ok: false, reason: 'not_json' })
  })

  it('rejects a missing content type', async () => {
    const f = vi.fn(async () => new Response(new Blob([JSON.stringify(DOC)]), { status: 200 }))
    expect((await resolveClient(ID, deps(f))).ok).toBe(false)
  })

  it('rejects malformed JSON', async () => {
    expect(await resolveClient(ID, withDoc('{"client_id": '))).toEqual({ ok: false, reason: 'not_json' })
  })

  it('rejects a non-object JSON document', async () => {
    expect(await resolveClient(ID, withDoc('[1,2]'))).toEqual({ ok: false, reason: 'invalid_document' })
  })

  it('rejects a client_id mismatch (including near-misses)', async () => {
    for (const cid of [
      'https://chatgpt.com/other.json',
      'https://chatgpt.com/oauth/client.json/',
      'HTTPS://chatgpt.com/oauth/client.json',
    ]) {
      __resetCimdCacheForTests()
      expect(await resolveClient(ID, withDoc({ ...DOC, client_id: cid }))).toEqual({ ok: false, reason: 'client_id_mismatch' })
    }
  })

  it.each([
    ['empty redirect_uris', { redirect_uris: [] }],
    ['missing redirect_uris', { redirect_uris: undefined }],
    ['http redirect', { redirect_uris: ['http://chatgpt.com/cb'] }],
    ['redirect with fragment', { redirect_uris: ['https://chatgpt.com/cb#x'] }],
    ['redirect with credentials', { redirect_uris: ['https://u:p@chatgpt.com/cb'] }],
    ['relative redirect', { redirect_uris: ['/cb'] }],
    ['javascript redirect', { redirect_uris: ['javascript:alert(1)'] }],
    ['non-string redirect', { redirect_uris: [42] }],
    ['empty client_name', { client_name: '' }],
    ['whitespace client_name', { client_name: '   ' }],
    ['control chars in client_name', { client_name: 'Chat\u0000GPT' }],
    ['overlong client_name', { client_name: 'x'.repeat(201) }],
    ['missing client_name', { client_name: undefined }],
    ['grant_types without authorization_code', { grant_types: ['client_credentials'] }],
    ['response_types without code', { response_types: ['token'] }],
    ['wrong type for grant_types', { grant_types: 'authorization_code' }],
  ])('rejects %s', async (_n, patch) => {
    const doc: Record<string, unknown> = { ...DOC, ...patch }
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete doc[k]
    expect(await resolveClient(ID, withDoc(doc))).toEqual({ ok: false, reason: 'invalid_document' })
  })

  it('rejects unsupported token auth methods', async () => {
    expect(await resolveClient(ID, withDoc({ ...DOC, token_endpoint_auth_methods_supported: ['client_secret_basic'] }))).toEqual({
      ok: false,
      reason: 'unsupported_auth_method',
    })
    __resetCimdCacheForTests()
    const { token_endpoint_auth_methods_supported: _omit, ...noMethod } = DOC
    expect(await resolveClient(ID, withDoc({ ...noMethod, token_endpoint_auth_method: 'private_key_jwt' }))).toEqual({
      ok: false,
      reason: 'unsupported_auth_method',
    })
  })

  it('does not guess a default auth method: an absent method is RFC 7591 client_secret_basic and is rejected', async () => {
    const { token_endpoint_auth_methods_supported: _omit, ...noMethod } = DOC
    expect(await resolveClient(ID, withDoc(noMethod))).toEqual({ ok: false, reason: 'unsupported_auth_method' })
  })

  it('allows loopback http redirect URIs only behind the dev flag, never in production', async () => {
    const doc = { ...DOC, redirect_uris: ['http://127.0.0.1:6274/callback'] }
    expect((await resolveClient(ID, withDoc(doc))).ok).toBe(false)
    vi.stubEnv('MCP_ALLOW_LOOPBACK_REDIRECTS', '1')
    __resetCimdCacheForTests()
    expect((await resolveClient(ID, withDoc(doc))).ok).toBe(true)
    vi.stubEnv('NODE_ENV', 'production')
    __resetCimdCacheForTests()
    expect((await resolveClient(ID, withDoc(doc))).ok).toBe(false)
    vi.unstubAllEnvs()
  })
})

describe('CIMD resolver — cache', () => {
  it('caches a validated document under the client_id', async () => {
    const f = vi.fn(async () => json(DOC))
    await resolveClient(ID, deps(f))
    await resolveClient(ID, deps(f))
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('never caches failures', async () => {
    const g = vi.fn(async () => new Response('x', { status: 500 }))
    await resolveClient(ID, deps(g))
    await resolveClient(ID, deps(g))
    expect(g).toHaveBeenCalledTimes(2)
    const bad = vi.fn(async () => json({ ...DOC, client_id: 'https://chatgpt.com/x.json' }))
    await resolveClient(ID, deps(bad))
    await resolveClient(ID, deps(bad))
    expect(bad).toHaveBeenCalledTimes(2)
  })

  it('caps a huge remote max-age at one hour', async () => {
    let now = 1_000_000
    const f = vi.fn(async () => json(DOC, { 'cache-control': 'public, max-age=31536000' }))
    const d = deps(f, { now: () => now })
    await resolveClient(ID, d)
    now += 59 * 60_000
    await resolveClient(ID, d)
    expect(f).toHaveBeenCalledTimes(1)
    now += 2 * 60_000
    await resolveClient(ID, d)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('defaults to ten minutes without a max-age and honours a shorter one', async () => {
    let now = 0
    const f = vi.fn(async () => json(DOC))
    const d = deps(f, { now: () => now })
    await resolveClient(ID, d)
    now += 9 * 60_000
    await resolveClient(ID, d)
    expect(f).toHaveBeenCalledTimes(1)
    now += 2 * 60_000
    await resolveClient(ID, d)
    expect(f).toHaveBeenCalledTimes(2)

    __resetCimdCacheForTests()
    now = 0
    const g = vi.fn(async () => json(DOC, { 'cache-control': 'max-age=30' }))
    const e = deps(g, { now: () => now })
    await resolveClient(ID, e)
    now += 31_000
    await resolveClient(ID, e)
    expect(g).toHaveBeenCalledTimes(2)
  })

  it('does not cache when the server says no-store or max-age=0', async () => {
    for (const cc of ['no-store', 'max-age=0']) {
      __resetCimdCacheForTests()
      const f = vi.fn(async () => json(DOC, { 'cache-control': cc }))
      await resolveClient(ID, deps(f))
      await resolveClient(ID, deps(f))
      expect(f, cc).toHaveBeenCalledTimes(2)
    }
  })

  it('bounds the number of cache entries', async () => {
    const make = (i: number) => `https://chatgpt.com/oauth/c${i}.json`
    const f = vi.fn(async (u: string) => json({ ...DOC, client_id: u }))
    for (let i = 0; i < 51; i++) await resolveClient(make(i), deps(f))
    expect(f).toHaveBeenCalledTimes(51)
    await resolveClient(make(0), deps(f)) // oldest entry was evicted
    expect(f).toHaveBeenCalledTimes(52)
    await resolveClient(make(50), deps(f)) // newest is still cached
    expect(f).toHaveBeenCalledTimes(52)
  })

  it('a cached client is not served for a different (rejected) client_id', async () => {
    const f = vi.fn(async () => json(DOC))
    await resolveClient(ID, deps(f))
    expect(await resolveClient('https://chatgpt.com:443/oauth/client.json', deps(f))).toEqual({
      ok: false,
      reason: 'client_id_not_allowed',
    })
  })
})
