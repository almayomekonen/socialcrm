import { describe, expect, it, vi } from 'vitest'
import { HarnessRefused } from '../live/quote/safety'
import { createRenderLimiter, readCloudLimits, redactSensitive } from '../live/cloud/renderLimit'
import { assertHebrewFontsEmbedded, parsePdfFonts } from '../live/cloud/pdfFonts'
import { createR2Counter, kindOfCommand, readR2Limits, r2LimitDefaults, R2_CEILING } from '../live/cloud/r2Limit'
import { filenameFrom } from '../live/cloud/helpers'

/** The rule the cloud harness applies to every PDF. If it can be fooled, so can the harness. */

const HEAD = ['name                                 type              encoding         emb sub uni object ID', '------------------------------------ ----------------- ---------------- --- --- --- ---------']
const row = (name: string, emb = 'yes') => `${name.padEnd(36)} CID TrueType      Identity-H       ${emb} yes yes     12  0`
const table = (...rows: string[]) => [...HEAD, ...rows, ''].join('\n')

describe('parsePdfFonts', () => {
  it('reads each row, with a name containing a space', () => {
    expect(parsePdfFonts(table(row('AAAAAA+NotoSansHebrew-Regular'), row('Some Font Name', 'no')))).toEqual([
      { name: 'AAAAAA+NotoSansHebrew-Regular', type: 'CID TrueType', embedded: true },
      { name: 'Some Font Name', type: 'CID TrueType', embedded: false },
    ])
  })
  it('refuses output that is not the table', () => expect(() => parsePdfFonts('Syntax Error')).toThrow('no table'))
})

describe('assertHebrewFontsEmbedded', () => {
  const fonts = (...rows: string[]) => parsePdfFonts(table(...rows))
  it('passes when NotoSansHebrew is there and every font is embedded', () => expect(() => assertHebrewFontsEmbedded(fonts(row('AAAAAA+NotoSansHebrew-Bold'), row('BBBBBB+Arial')))).not.toThrow())
  it('fails without NotoSansHebrew', () => expect(() => assertHebrewFontsEmbedded(fonts(row('BBBBBB+Arial')))).toThrow('NotoSansHebrew is missing'))
  it('fails when any font is not embedded, even beside the right one', () => expect(() => assertHebrewFontsEmbedded(fonts(row('AAAAAA+NotoSansHebrew-Bold'), row('Helvetica', 'no')))).toThrow('not embedded: Helvetica'))
  it('fails on a PDF with no fonts', () => expect(() => assertHebrewFontsEmbedded(fonts())).toThrow('lists no fonts'))
})

describe('filenameFrom', () => {
  it('returns the decoded Hebrew name and the ASCII fallback', () => {
    expect(filenameFrom(`attachment; filename="Quote-1-___.pdf"; filename*=UTF-8''Quote-1-${encodeURIComponent('דני')}.pdf`)).toEqual({ utf8: 'Quote-1-דני.pdf', ascii: 'Quote-1-___.pdf' })
  })
  it('refuses a header with either name missing', () => {
    expect(() => filenameFrom('attachment; filename="a.pdf"')).toThrow()
    expect(() => filenameFrom(null)).toThrow()
  })
})

describe('render limits and log redaction', () => {
  const limits = { maxRenders: 3, maxRetries: 1 }
  const ACCOUNT = 'a'.repeat(32)
  const URL_PDF = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-run/pdf?cacheTTL=0`
  const make = () => {
    const inner = vi.fn(async () => new Response('ok'))
    return { inner, l: createRenderLimiter({ inner: inner as never, accountId: ACCOUNT, limits }) }
  }
  const send = (l: ReturnType<typeof make>['l'], body: string) => l.fetch(URL_PDF, { method: 'POST', body })

  it.each([
    [{}, 'missing'],
    [{ QUOTE_CLOUD_MAX_RENDERS: '20' }, 'retries missing'],
    [{ QUOTE_CLOUD_MAX_RENDERS: 'x', QUOTE_CLOUD_MAX_RETRIES: '1' }, 'not a number'],
    [{ QUOTE_CLOUD_MAX_RENDERS: '1.5', QUOTE_CLOUD_MAX_RETRIES: '0' }, 'a fraction'],
    [{ QUOTE_CLOUD_MAX_RENDERS: '0', QUOTE_CLOUD_MAX_RETRIES: '0' }, 'zero renders'],
    [{ QUOTE_CLOUD_MAX_RENDERS: '21', QUOTE_CLOUD_MAX_RETRIES: '1' }, 'over the ceiling'],
    [{ QUOTE_CLOUD_MAX_RENDERS: '20', QUOTE_CLOUD_MAX_RETRIES: '4' }, 'retries over the ceiling'],
    [{ QUOTE_CLOUD_MAX_RENDERS: '2', QUOTE_CLOUD_MAX_RETRIES: '2' }, 'retries not below renders'],
  ])('%j is refused (%s)', (source: Record<string, string>, _why: string) => expect(() => readCloudLimits(source)).toThrow(HarnessRefused))
  it('accepts valid limits', () => expect(readCloudLimits({ QUOTE_CLOUD_MAX_RENDERS: '20', QUOTE_CLOUD_MAX_RETRIES: '3' })).toEqual({ maxRenders: 20, maxRetries: 3 }))

  it('stops at the request limit and stays stopped', async () => {
    const { inner, l } = make()
    for (const b of ['a', 'b', 'c']) await send(l, b)
    await expect(send(l, 'd')).rejects.toBeInstanceOf(HarnessRefused)
    await expect(send(l, 'e')).rejects.toBeInstanceOf(HarnessRefused)
    expect(inner).toHaveBeenCalledTimes(3)
    expect(l.state).toEqual({ requests: 3, retries: 0, refused: 2, stopped: true })
  })
  it('counts a repeated body as a retry and stops at the retry limit', async () => {
    const { inner, l } = make()
    await send(l, 'a')
    await send(l, 'a')
    await expect(send(l, 'a')).rejects.toBeInstanceOf(HarnessRefused)
    expect(inner).toHaveBeenCalledTimes(2)
    expect(l.state).toMatchObject({ requests: 2, retries: 1, stopped: true })
  })
  it('refuses any other Cloudflare API path, even within the limit', async () => {
    const { inner, l } = make()
    await expect(l.fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/tokens`, {})).rejects.toBeInstanceOf(HarnessRefused)
    await expect(l.fetch(`https://api.cloudflare.com/client/v4/accounts/${'b'.repeat(32)}/browser-run/pdf`, {})).rejects.toBeInstanceOf(HarnessRefused)
    expect(inner).not.toHaveBeenCalled()
  })
  it('other hosts pass through uncounted', async () => {
    const { inner, l } = make()
    await l.fetch(`https://${ACCOUNT}.r2.cloudflarestorage.com/b/k`)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(l.state.requests).toBe(0)
  })
  it('redacts signed links, signature parts and known secrets', () => {
    const url = 'https://x.r2.cloudflarestorage.com/b/k?X-Amz-Signature=abc&X-Amz-Expires=60'
    expect(redactSensitive(`got ${url} end`, [])).toBe('got [signed-url] end')
    expect(redactSensitive('X-Amz-Credential=KEY/1&x=2', [])).toBe('X-Amz-Credential=[redacted]&x=2')
    expect(redactSensitive('token sekret here', ['sekret'])).toBe('token [redacted] here')
  })
})

describe('R2 operation limits', () => {
  const good = r2LimitDefaults({})
  it('accepts the ceilings', () => expect(readR2Limits(good)).toEqual(R2_CEILING))
  it.each(Object.keys(good))('%s missing, empty, invalid or over its ceiling is refused', (name) => {
    const without = { ...good }
    delete without[name]
    expect(() => readR2Limits(without)).toThrow(HarnessRefused)
    for (const bad of ['', 'x', '1.5', '-1', '0', '9999']) expect(() => readR2Limits({ ...good, [name]: bad })).toThrow(HarnessRefused)
  })
  const limits = { uploads: 2, deletes: 1, reads: 1, lists: 1, objects: 2 }

  it('each kind stops at its own limit, and one kind stopping does not stop another', () => {
    const c = createR2Counter(limits)
    c.begin('delete')
    expect(() => c.begin('delete')).toThrow(HarnessRefused)
    expect(() => c.begin('read')).not.toThrow()
    expect(() => c.begin('list')).not.toThrow()
    expect(() => c.begin('read')).toThrow(HarnessRefused)
    expect(c.state.refused).toMatchObject({ delete: 1, read: 1 })
  })
  it('a failed upload uses an attempt but is not a completed upload or a created object', () => {
    const c = createR2Counter(limits)
    c.begin('upload', 'a')
    c.fail('upload', 'a')
    expect(c.state.attempts.upload).toBe(1)
    expect(c.state.completed.upload).toBe(0)
    expect(c.state.objectsCreated).toBe(0)
    c.begin('upload', 'b')
    c.succeed('upload', 'b')
    expect(c.state.completed.upload).toBe(1)
    expect(c.state.objectsCreated).toBe(1)
    expect(() => c.begin('upload', 'c')).toThrow(HarnessRefused)
  })
  it('a failed delete is not a completed delete', () => {
    const c = createR2Counter(limits)
    c.begin('delete', 'a')
    c.fail('delete', 'a')
    expect(c.state.completed.delete).toBe(0)
  })
  it('the object limit counts distinct new keys, including uploads still in flight', () => {
    const c = createR2Counter({ ...limits, uploads: 5, objects: 1 })
    c.begin('upload', 'a')
    expect(() => c.begin('upload', 'b')).toThrow(/object/)
    c.succeed('upload', 'a')
    expect(() => c.begin('upload', 'a')).not.toThrow()
  })
  it('only the five known commands have a kind', () => {
    expect(['PutObjectCommand', 'DeleteObjectCommand', 'GetObjectCommand', 'HeadObjectCommand', 'ListObjectsV2Command'].map(kindOfCommand)).toEqual(['upload', 'delete', 'read', 'read', 'list'])
    for (const other of ['DeleteObjectsCommand', 'CopyObjectCommand', 'DeleteBucketCommand', 'PutBucketPolicyCommand']) expect(kindOfCommand(other)).toBeNull()
  })
})
