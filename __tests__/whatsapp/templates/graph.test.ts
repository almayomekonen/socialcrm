import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTemplateOnMeta, mapCreateError } from '@/lib/whatsapp/templates/graph'

const args = {
  wabaId: 'WABA_1',
  accessToken: 'secret-token',
  name: 'follow_up',
  language: 'he',
  category: 'UTILITY' as const,
  components: [{ type: 'BODY' as const, text: 'היי {{1}}', example: { body_text: [['דוד']] } }],
}

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('mapCreateError → Hebrew (never raw)', () => {
  it('maps auth / rate-limit / invalid / generic', () => {
    expect(mapCreateError(190, 200)).toMatch(/חיבור/)
    expect(mapCreateError(undefined, 401)).toMatch(/חיבור/)
    expect(mapCreateError(4, 200)).toMatch(/מכסת/)
    expect(mapCreateError(undefined, 429)).toMatch(/מכסת/)
    expect(mapCreateError(100, 400)).toMatch(/נוסח|לפשט/)
    expect(mapCreateError(999999, 500)).toMatch(/השתבש/)
  })
  it('all outputs are Hebrew with no raw code leaking', () => {
    for (const [code, http] of [[190, 200], [4, 200], [100, 400], [1, 500]] as const) {
      const out = mapCreateError(code, http)
      expect(out).toMatch(/[֐-׿]/)
      expect(out).not.toMatch(/\d{3,}/)
    }
  })
})

describe('createTemplateOnMeta', () => {
  it('POSTs to /{wabaId}/message_templates with the Bearer token and payload', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, { id: 'MT_1', status: 'PENDING' }))
    const out = await createTemplateOnMeta(args)
    expect(out).toEqual({ ok: true, metaTemplateId: 'MT_1', status: 'PENDING' })
    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toContain('/WABA_1/message_templates')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret-token' })
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toMatchObject({ name: 'follow_up', language: 'he', category: 'UTILITY' })
    expect(sent.components[0].type).toBe('BODY')
  })

  it('maps a Graph error to Hebrew and returns the raw code only for server logging', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(400, { error: { code: 100, message: 'Invalid parameter' } }))
    const out = await createTemplateOnMeta(args)
    expect(out.ok).toBe(false)
    if ('error' in out) {
      expect(out.error).toMatch(/[֐-׿]/)
      expect(out.error).not.toContain('Invalid parameter')
      expect(out.error).not.toMatch(/\d{3,}/)
      expect(out.httpStatus).toBe(400)
    }
  })

  it('rate limit → Hebrew rate-limit copy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(429, { error: { code: 130429 } }))
    const out = await createTemplateOnMeta(args)
    expect(out.ok).toBe(false)
    if ('error' in out) expect(out.error).toMatch(/מכסת/)
  })

  it('missing id in a 200 → generic failure (no false success)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, {}))
    const out = await createTemplateOnMeta(args)
    expect(out.ok).toBe(false)
  })

  it('network throw → generic Hebrew failure, never throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    const out = await createTemplateOnMeta(args)
    expect(out.ok).toBe(false)
    if ('error' in out) expect(out.error).toMatch(/[֐-׿]/)
  })
})
