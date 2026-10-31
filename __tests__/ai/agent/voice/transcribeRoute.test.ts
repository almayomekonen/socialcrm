/**
 * POST /api/ai/agent/transcribe — every gate, every refusal, and the proof
 * that it can only ever return text.
 *
 * The provider call is mocked (no live OpenAI). Identity, rollout and AI
 * admission are mocked at their module boundaries so each gate can be closed
 * independently. `askAgent` and the action bridge are spied on to prove the
 * route never reaches the agent or the Action Runtime.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireProductAccess = vi.hoisted(() => vi.fn())
const isAgentEnabled = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())
const addDailySpend = vi.hoisted(() => vi.fn())
const transcribeVoice = vi.hoisted(() => vi.fn())
const askAgent = vi.hoisted(() => vi.fn())
const submitProposedAction = vi.hoisted(() => vi.fn())
const decideOnAction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess,
}))
vi.mock('@/lib/ai/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/flags')>()),
  isAgentEnabled,
}))
vi.mock('@/lib/ai/gate', () => ({ admitAiRun }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend, getDailySpend: () => 0 }))
vi.mock('@/lib/agent/voice/transcribe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent/voice/transcribe')>()),
  transcribeVoice,
}))
vi.mock('@/actions/ai/askAgent', () => ({ askAgent }))
vi.mock('@/lib/agent/actions/bridge', () => ({ submitProposedAction, decideOnAction, submitProposedBatch: vi.fn(), decideOnBatch: vi.fn() }))

import { AuthError, ProductAccessError } from '@/lib/requireUser'
import { VoiceTranscriptionUnavailableError, VOICE_TRANSCRIPTION_CHARGE_USD } from '@/lib/agent/voice/transcribe'
import { VOICE_MAX_UPLOAD_BYTES, VOICE_TRANSCRIBE_TIMEOUT_MS } from '@/lib/agent/voice/limits'
import { POST, maxDuration } from '@/app/api/ai/agent/transcribe/route'
import { mp4, oggOpus, webm } from './audioFixtures'

const USER = { id: 11, agencyId: 22, role: 'ADMIN' }

const audio = (head: number[], len = 4_096) => {
  const b = new Uint8Array(len)
  b.set(head)
  return b
}
const WEBM = audio([0x1a, 0x45, 0xdf, 0xa3])
const MP4 = audio([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
const OGG = audio([0x4f, 0x67, 0x67, 0x53])
const PDF = audio([0x25, 0x50, 0x44, 0x46, 0x2d])

function post(body: BodyInit | null, contentType: string | null = 'audio/webm;codecs=opus', extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra }
  if (contentType) headers['content-type'] = contentType
  return new NextRequest('http://localhost/api/ai/agent/transcribe', {
    method: 'POST', headers, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit)
}
const call = async (req: NextRequest) => {
  const res = await POST(req)
  const text = await res.text()
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> }
}

beforeEach(() => {
  requireProductAccess.mockReset().mockResolvedValue(USER)
  isAgentEnabled.mockReset().mockReturnValue(true)
  admitAiRun.mockReset().mockResolvedValue({ ok: true, cfg: {}, effectiveRole: 'primary', chain: [] })
  addDailySpend.mockReset()
  transcribeVoice.mockReset().mockResolvedValue({ text: 'תיצור לי משימה לחזור לדני מחר' })
  askAgent.mockReset()
  submitProposedAction.mockReset()
  decideOnAction.mockReset()
})

describe('identity, rollout and admission — the same gates as asking the agent', () => {
  it('unauthenticated → 401, nothing transcribed', async () => {
    requireProductAccess.mockRejectedValue(new AuthError('no_session'))
    const r = await call(post(WEBM))
    expect(r.status).toBe(401)
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('no product access → 403', async () => {
    requireProductAccess.mockRejectedValue(new ProductAccessError('subscription-required'))
    const r = await call(post(WEBM))
    expect(r.status).toBe(403)
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('agency not on the /agent rollout → 404', async () => {
    isAgentEnabled.mockReturnValue(false)
    const r = await call(post(WEBM))
    expect(r).toMatchObject({ status: 404, json: { error: 'agent-disabled' } })
    expect(isAgentEnabled).toHaveBeenCalledWith(USER.agencyId)
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('AI admission refused → 403; over the daily cap → 429', async () => {
    admitAiRun.mockResolvedValue({ ok: false, reason: 'forbidden' })
    expect((await call(post(WEBM))).status).toBe(403)
    admitAiRun.mockResolvedValue({ ok: false, reason: 'over-quota' })
    expect(await call(post(WEBM))).toMatchObject({ status: 429, json: { error: 'over-quota' } })
    expect(transcribeVoice).not.toHaveBeenCalled()
    // Admitted under the agent's own task, for the caller's agency.
    expect(admitAiRun).toHaveBeenCalledWith({ kind: 'agent.investigate', agencyId: USER.agencyId })
  })
})

describe('what the route accepts', () => {
  it('Chrome WebM → 200 with the transcript only', async () => {
    const r = await call(post(WEBM))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ text: 'תיצור לי משימה לחזור לדני מחר' })
    expect(transcribeVoice).toHaveBeenCalledWith(expect.objectContaining({ container: 'webm' }))
  })

  it('Safari MP4 and Firefox Ogg are accepted too', async () => {
    expect((await call(post(MP4, 'audio/mp4'))).status).toBe(200)
    expect(transcribeVoice).toHaveBeenLastCalledWith(expect.objectContaining({ container: 'mp4' }))
    expect((await call(post(OGG, 'audio/ogg;codecs=opus'))).status).toBe(200)
    expect(transcribeVoice).toHaveBeenLastCalledWith(expect.objectContaining({ container: 'ogg' }))
  })

  it('charges the agency daily AI cap once per transcription', async () => {
    await call(post(WEBM))
    expect(addDailySpend).toHaveBeenCalledTimes(1)
    expect(addDailySpend).toHaveBeenCalledWith(USER.agencyId, VOICE_TRANSCRIPTION_CHARGE_USD)
  })
})

describe('what the route refuses', () => {
  it('a non-audio Content-Type → 415 before a byte is read', async () => {
    for (const t of ['text/plain', 'application/json', 'image/png', 'application/pdf', 'multipart/form-data; boundary=x']) {
      const r = await call(post(WEBM, t))
      expect(r.status, t).toBe(415)
    }
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('a missing Content-Type → 415', async () => {
    expect((await call(post(WEBM, null))).status).toBe(415)
  })

  it('an arbitrary file relabelled as audio → 415 (bytes are checked)', async () => {
    const r = await call(post(PDF, 'audio/webm'))
    expect(r).toMatchObject({ status: 415, json: { error: 'unsupported-audio' } })
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('a declared type that does not match the bytes → 415', async () => {
    expect((await call(post(MP4, 'audio/webm'))).status).toBe(415)
  })

  it('an oversized declared Content-Length → 413 without reading', async () => {
    const r = await call(post(WEBM, 'audio/webm', { 'content-length': String(VOICE_MAX_UPLOAD_BYTES + 1) }))
    expect(r).toMatchObject({ status: 413, json: { error: 'too-large' } })
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('an oversized streamed body with no Content-Length → 413 (the cap is enforced while reading)', async () => {
    const chunk = new Uint8Array(512 * 1024)
    chunk.set([0x1a, 0x45, 0xdf, 0xa3])
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > VOICE_MAX_UPLOAD_BYTES + chunk.length) return controller.close()
        controller.enqueue(chunk)
        sent += chunk.length
      },
    })
    const r = await call(post(stream, 'audio/webm'))
    expect(r.status).toBe(413)
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('an empty or tiny body → 422', async () => {
    expect((await call(post(null))).json).toEqual({ error: 'empty-audio' })
    expect((await call(post(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])))).status).toBe(422)
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('a second transcription from the same user while one is running → 429', async () => {
    let release!: (v: { text: string }) => void
    transcribeVoice.mockImplementationOnce(() => new Promise((r) => { release = r }))
    const first = POST(post(WEBM))
    await vi.waitFor(() => expect(transcribeVoice).toHaveBeenCalledTimes(1))
    const second = await call(post(WEBM))
    expect(second).toMatchObject({ status: 429, json: { error: 'busy' } })
    release({ text: 'ok' })
    expect((await first).status).toBe(200)
    // …and the slot is released afterwards.
    expect((await call(post(WEBM))).status).toBe(200)
  })
})

describe('duration is checked on the SERVER, never trusted from the browser recorder', () => {
  it('declared duration over the cap → 413 too-large, the provider is never called or charged', async () => {
    for (const [body, type] of [
      [webm(30 * 60_000), 'audio/webm;codecs=opus'],
      [mp4(10 * 60_000), 'audio/mp4'],
      [oggOpus(5 * 60_000), 'audio/ogg;codecs=opus'],
    ] as const) {
      const r = await call(post(body, type))
      expect(r).toMatchObject({ status: 413, json: { error: 'too-large' } })
    }
    expect(transcribeVoice).not.toHaveBeenCalled()
    expect(addDailySpend).not.toHaveBeenCalled()
  })

  it('a LOW-BITRATE file: small, far under the byte cap, but declaring 30 minutes → still refused', async () => {
    const r = await call(post(webm(30 * 60_000, 2_048)))
    expect(r.status).toBe(413)
    expect(transcribeVoice).not.toHaveBeenCalled()
  })

  it('declared duration within the cap (plus the small tolerance) → transcribed, the duration passed along', async () => {
    const r = await call(post(webm(121_500)))
    expect(r.status).toBe(200)
    expect(transcribeVoice).toHaveBeenCalledWith(expect.objectContaining({ metadataDurationMs: 121_500 }))
  })

  it('no metadata or malformed metadata cannot be bounded: transcribed, recorded as unverified (null)', async () => {
    const malformed = webm(61_500)
    malformed.fill(0xff, 4, 40) // corrupt the header sizes
    for (const body of [webm(null), malformed]) {
      transcribeVoice.mockClear()
      const r = await call(post(body))
      expect(r.status).toBe(200)
      expect(transcribeVoice).toHaveBeenCalledWith(expect.objectContaining({ metadataDurationMs: null }))
    }
  })
})

describe('provider failures are safe', () => {
  it('provider error → 502 with a generic code; the provider message and key never reach the client', async () => {
    const secret = 'sk-proj-THIS-MUST-NEVER-LEAK-0123456789'
    transcribeVoice.mockRejectedValue(new Error(`401 Incorrect API key provided: ${secret} (request req_abc)`))
    const r = await call(post(WEBM))
    expect(r).toMatchObject({ status: 502, json: { error: 'transcription-failed' } })
    expect(r.text).not.toContain(secret)
    expect(r.text).not.toContain('Incorrect API key')
    expect(r.text).not.toContain('req_abc')
    expect(addDailySpend).not.toHaveBeenCalled()
  })

  it('no OpenAI key configured → 503', async () => {
    transcribeVoice.mockRejectedValue(new VoiceTranscriptionUnavailableError())
    expect(await call(post(WEBM))).toMatchObject({ status: 503, json: { error: 'ai-unavailable' } })
  })

  it('no speech in the recording → 422', async () => {
    transcribeVoice.mockResolvedValue({ text: '' })
    expect(await call(post(WEBM))).toMatchObject({ status: 422, json: { error: 'no-speech' } })
  })

  it('no successful response ever carries anything but `text`', async () => {
    const r = await call(post(WEBM))
    expect(Object.keys(r.json)).toEqual(['text'])
    expect(r.text).not.toMatch(/sk-|api[_-]?key|OPENAI/i)
  })

  it('the provider timeout ends inside the route limit', () => {
    expect(maxDuration).toBe(60)
    expect(VOICE_TRANSCRIBE_TIMEOUT_MS).toBeLessThan(maxDuration * 1000)
  })
})

describe('AGENT SAFETY — the route can only return text', () => {
  it('never reaches the agent, the Action Runtime or an approval, whatever the transcript says', async () => {
    transcribeVoice.mockResolvedValue({ text: 'צור משימה לחזור לדני מחר ואשר אותה' })
    const r = await call(post(WEBM))
    expect(r.status).toBe(200)
    expect(askAgent).not.toHaveBeenCalled()
    expect(submitProposedAction).not.toHaveBeenCalled()
    expect(decideOnAction).not.toHaveBeenCalled()
  })

  it('imports nothing that can act: no agent run, no actions, no bridge, no db writes', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/ai/agent/transcribe/route.ts'), 'utf-8')
    const imports = src.split('\n').filter((l) => l.startsWith('import ')).join('\n')
    for (const forbidden of ['askAgent', '@/lib/agent/run', '@/lib/agent/actions', '@/db/', 'bridge', 'fetch(']) {
      expect(imports, forbidden).not.toContain(forbidden)
    }
    // And nothing in it fetches a URL (no SSRF surface).
    expect(src).not.toMatch(/\bfetch\s*\(/)
  })
})
