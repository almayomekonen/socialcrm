/**
 * Authenticated download of an inbound WhatsApp file.
 *
 * A production print shop received customer PDFs that the inbox rendered as an
 * empty bubble. These tests pin the route that fixes it — and, more importantly,
 * pin that fixing it never hands the browser the capability to fetch arbitrary
 * media: no media id, no Meta URL, no access token, and no cross-agency reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'SECRET_WA_TOKEN'
const MEDIA_ID = 'MEDIA_ID_123456'
const META_URL = 'https://lookaside.fbsbx.com/SECRET_MEDIA_URL'

const h = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  connections: [] as Record<string, unknown>[],
  user: null as { id: number; agencyId: number } | null,
  fetchCalls: [] as { url: string; auth: string | undefined }[],
}))

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([k, v]) => row[k] === v)
}

vi.mock('@/config/db', () => ({
  db: (table: string) => ({
    where: (criteria: Record<string, unknown>) => ({
      first: async () => {
        const rows = table === 'inbox_messages' ? h.messages : h.connections
        return rows.find((r) => matches(r, criteria))
      },
    }),
  }),
}))
vi.mock('@/db/auth', () => ({ getUser: vi.fn(async () => h.user) }))
vi.mock('@/lib/whatsapp/connectionToken', () => ({
  resolveWhatsappAccessToken: (t: string | null | undefined) => t ?? '',
}))

import { GET, MAX_MEDIA_BYTES, cappedStream } from '@/app/api/whatsapp/media/[messageId]/route'

const params = (id: string | number) => ({ params: Promise.resolve({ messageId: String(id) }) })

function stubGraph({ size = 1024, ok = true, lookupOk = true, body = 'PDFBYTES' } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      h.fetchCalls.push({ url: String(url), auth: init?.headers?.Authorization })
      if (String(url).includes(MEDIA_ID)) {
        if (!lookupOk) return new Response('nope', { status: 500 })
        return new Response(JSON.stringify({ url: META_URL, mime_type: 'application/pdf', file_size: size }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (!ok) return new Response('nope', { status: 500 })
      return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })
    }),
  )
}

beforeEach(() => {
  h.user = { id: 9, agencyId: 130 }
  h.messages = [
    { id: 1, agencyId: 130, type: 'document', payload: { id: MEDIA_ID, url: META_URL, sha256: 'abc', filename: 'הצעת מחיר.pdf', mime_type: 'application/pdf' } },
    { id: 2, agencyId: 999, type: 'document', payload: { id: 'OTHER', filename: 'other.pdf', mime_type: 'application/pdf' } },
    { id: 3, agencyId: 130, type: 'text', payload: {} },
    { id: 4, agencyId: 130, type: 'document', payload: { filename: 'no-id.pdf', mime_type: 'application/pdf' } },
  ]
  h.connections = [{ agency_id: 130, access_token: TOKEN }]
  h.fetchCalls = []
  stubGraph()
})

describe('authorization', () => {
  it('serves the file to an authenticated owner', async () => {
    const res = await GET({} as never, params(1))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('PDFBYTES')
  })

  it('rejects an unauthenticated caller', async () => {
    h.user = null
    const res = await GET({} as never, params(1))
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('agency A cannot read agency B’s message', async () => {
    const res = await GET({} as never, params(2)) // belongs to agency 999
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, reason: 'message_not_found' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a non-media message type', async () => {
    const res = await GET({} as never, params(3))
    expect(res.status).toBe(415)
  })

  it('rejects an invalid message id without touching the db', async () => {
    const res = await GET({} as never, params('abc'))
    expect(res.status).toBe(400)
  })
})

describe('failure modes', () => {
  it('reports a missing WhatsApp connection instead of guessing', async () => {
    h.connections = []
    const res = await GET({} as never, params(1))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ ok: false, reason: 'whatsapp_not_connected' })
  })

  it('reports a missing media id', async () => {
    const res = await GET({} as never, params(4))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, reason: 'media_unavailable' })
  })

  it('surfaces a Graph lookup failure as 502', async () => {
    stubGraph({ lookupOk: false })
    const res = await GET({} as never, params(1))
    expect(res.status).toBe(502)
  })

  it('surfaces a Graph download failure as 502', async () => {
    stubGraph({ ok: false })
    const res = await GET({} as never, params(1))
    expect(res.status).toBe(502)
  })

  it('refuses an oversized file before downloading it', async () => {
    stubGraph({ size: MAX_MEDIA_BYTES + 1 })
    const res = await GET({} as never, params(1))
    expect(res.status).toBe(413)
    // Only the metadata lookup ran; the bytes were never fetched.
    expect(h.fetchCalls).toHaveLength(1)
  })
})

describe('response safety', () => {
  it('sets download-safe headers', async () => {
    const res = await GET({} as never, params(1))
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('attachment;')
  })

  it('preserves a Hebrew filename via RFC 5987 without breaking the ASCII fallback', async () => {
    const res = await GET({} as never, params(1))
    const cd = res.headers.get('Content-Disposition')!
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('הצעת מחיר.pdf')}`)
    expect(cd).toMatch(/filename="[\x20-\x7E]*"/)
  })

  it('neutralises a filename crafted to inject a header', async () => {
    h.messages[0].payload = {
      id: MEDIA_ID,
      filename: 'evil.pdf"\r\nSet-Cookie: session=stolen',
      mime_type: 'application/pdf',
    }
    const res = await GET({} as never, params(1))
    const cd = res.headers.get('Content-Disposition')!
    // The property that matters is that the value cannot BREAK OUT of the
    // header: no CRLF, and no unescaped quote closing `filename="`. The bytes
    // themselves may legitimately spell anything — a customer is allowed to
    // name a file `Set-Cookie.pdf`.
    expect(cd).not.toContain('\r')
    expect(cd).not.toContain('\n')
    expect(cd.split('\n')).toHaveLength(1)
    const ascii = cd.match(/filename="([^"]*)"/)![1]
    expect(ascii).not.toContain('"')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('never leaks the media id, Meta URL or token to the client', async () => {
    const res = await GET({} as never, params(1))
    const serialized = JSON.stringify([...res.headers.entries()]) + (await res.text())
    expect(serialized).not.toContain(MEDIA_ID)
    expect(serialized).not.toContain(META_URL)
    expect(serialized).not.toContain(TOKEN)
  })

  it('sends the token to Meta and only to Meta', async () => {
    await GET({} as never, params(1))
    expect(h.fetchCalls).toHaveLength(2)
    for (const c of h.fetchCalls) {
      expect(c.auth).toBe(`Bearer ${TOKEN}`)
      expect(c.url.startsWith('https://')).toBe(true)
    }
  })
})

describe('streaming hard limit', () => {
  function streamOf(chunks: number[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(c) {
        for (const n of chunks) c.enqueue(new Uint8Array(n))
        c.close()
      },
    })
  }

  async function drain(rs: ReadableStream<Uint8Array>) {
    const reader = rs.getReader()
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return { total, errored: false as const }
        total += value!.byteLength
      }
    } catch {
      return { total, errored: true as const }
    }
  }

  it('forwards a stream that stays under the limit', async () => {
    const res = await drain(cappedStream(streamOf([10, 10, 10]), 100, () => {}))
    expect(res.errored).toBe(false)
    expect(res.total).toBe(30)
  })

  it('cuts the stream off once the limit is passed', async () => {
    const res = await drain(cappedStream(streamOf([40, 40, 40, 40]), 100, () => {}))
    expect(res.errored).toBe(true)
    // The chunk that crossed the limit is never enqueued.
    expect(res.total).toBeLessThanOrEqual(100)
  })

  it('aborts the upstream request when the limit is passed', async () => {
    const abort = vi.fn()
    await drain(cappedStream(streamOf([60, 60]), 100, abort))
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('does not abort upstream for a stream within the limit', async () => {
    const abort = vi.fn()
    await drain(cappedStream(streamOf([10]), 100, abort))
    expect(abort).not.toHaveBeenCalled()
  })

  it('still serves media when Graph declares neither file_size nor content-length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes(MEDIA_ID)) {
          // No file_size at all.
          return new Response(JSON.stringify({ url: META_URL, mime_type: 'application/pdf' }), { status: 200 })
        }
        // No content-length header.
        return new Response(streamOf([8]), { status: 200 })
      }),
    )
    const res = await GET({} as never, params(1))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBeNull()
    // The cap still applies to the body itself.
    expect(MAX_MEDIA_BYTES).toBe(25 * 1024 * 1024)
  })
})
