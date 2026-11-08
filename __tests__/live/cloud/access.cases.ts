import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { filenameFrom } from './helpers'
import { EXEMPT_USER, REP_WITH_LEAD, REP_WITHOUT_LEAD, USER, ctx, docsOf, leads, open, quote, signIn, start } from './harness'
import { session } from './session'

const isPdf = (b: ArrayBuffer) => Buffer.from(b.slice(0, 5)).toString('latin1') === '%PDF-'
const EXPIRY_MARGIN_MS = 65_000

/** Past the link's 60 seconds: real time against R2, the stand-in's own clock in dry mode. */
async function passExpiry(): Promise<void> {
  if (ctx.mode === 'real') await new Promise((r) => setTimeout(r, EXPIRY_MARGIN_MS))
  else (globalThis as unknown as { __dryClockOffsetMs: number }).__dryClockOffsetMs = EXPIRY_MARGIN_MS
}

export function accessCases(): void {
  it('the authenticated route redirects to a 60-second link that returns the same bytes', async () => {
    const q = await quote(1)
    await start(q.quoteId)
    const [d] = await docsOf(q.quoteId)
    const res = await open(d.contentHash as string)
    expect(res.status).toBe(302)
    const location = res.headers.get('location') as string
    expect(new URL(location).searchParams.get('X-Amz-Expires')).toBe('60')
    const got = await fetch(location)
    expect(got.status).toBe(200)
    expect(createHash('sha256').update(new Uint8Array(await got.arrayBuffer())).digest('hex')).toBe(d.contentHash)
  }, 200_000)

  it('a signed link works, then stops working after it expires', async () => {
    const q = await quote(1)
    await start(q.quoteId)
    const [d] = await docsOf(q.quoteId)
    const location = (await open(d.contentHash as string)).headers.get('location') as string
    const before = await fetch(location)
    expect(before.status).toBe(200)
    expect(isPdf(await before.arrayBuffer())).toBe(true)
    try {
      await passExpiry()
      const after = await fetch(location)
      expect(after.status >= 400 && after.status < 500).toBe(true)
      expect(isPdf(await after.arrayBuffer())).toBe(false)
    } finally {
      ;(globalThis as unknown as { __dryClockOffsetMs: number }).__dryClockOffsetMs = 0
    }
  }, 200_000)

  it('no session opens nothing', async () => {
    const saved = session.cookie
    session.cookie = undefined
    const res = await open('a'.repeat(64))
    session.cookie = saved
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/auth')
  })

  it('the download: the agency and lead rules hold, and R2 serves the Hebrew filename and the PDF type', async () => {
    const q = await quote(1, { leadId: leads.rep })
    await start(q.quoteId)
    const [d] = await docsOf(q.quoteId)
    try {
      for (const refused of [EXEMPT_USER, REP_WITHOUT_LEAD]) {
        await signIn(refused)
        const res = await open(d.contentHash as string)
        expect(res.status).toBe(404)
        expect(res.headers.get('location')).toBeNull()
      }
      await signIn(REP_WITH_LEAD)
      const ok = await open(d.contentHash as string)
      expect(ok.status).toBe(302)
      const got = await fetch(ok.headers.get('location') as string)
      expect(got.status).toBe(200)
      expect(got.headers.get('content-type')).toBe('application/pdf')
      const number = String(q.quoteNumber).padStart(5, '0')
      expect(filenameFrom(got.headers.get('content-disposition'))).toEqual({ utf8: `Quote-${number}-דוד_כהן.pdf`, ascii: `Quote-${number}-_______.pdf` })
      expect(createHash('sha256').update(new Uint8Array(await got.arrayBuffer())).digest('hex')).toBe(d.contentHash)
    } finally {
      await signIn(USER)
    }
  }, 200_000)
}
