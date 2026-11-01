/**
 * The three Agent API surfaces — ask, stream and voice transcribe — decide
 * availability together, from the session's agency, through the REAL flag
 * parsing and lib/ai/agentAvailability.ts (only identity, product access and
 * everything below the rollout gate are mocked). For each environment, either
 * all three let the request past the rollout gate or all three refuse it with
 * the same 404, and nothing a request body says changes which.
 *
 * The page, nav, mobile shell, Action Runtime bridge and WhatsApp identity are
 * pinned by agentAvailability.test.ts (static), agentNavOffice.test.tsx,
 * approvalBoundary.integration.test.ts and worker.db.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireProductAccess = vi.hoisted(() => vi.fn())
const access = vi.hoisted(() => vi.fn())
const askAgent = vi.hoisted(() => vi.fn())
const admitAiRun = vi.hoisted(() => vi.fn())
const transcribeVoice = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess,
}))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: access }))
vi.mock('@/actions/ai/askAgent', () => ({ askAgent }))
vi.mock('@/lib/ai/gate', () => ({ admitAiRun }))
vi.mock('@/lib/ai/router/spend', () => ({ addDailySpend: vi.fn(), getDailySpend: () => 0 }))
vi.mock('@/lib/agent/voice/transcribe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent/voice/transcribe')>()),
  transcribeVoice,
}))
vi.mock('@/lib/agent/actions/bridge', () => ({
  submitProposedAction: vi.fn(),
  decideOnAction: vi.fn(),
  submitProposedBatch: vi.fn(),
  decideOnBatch: vi.fn(),
}))

import { _resetAiEnvCacheForTests } from '@/lib/ai/env'
import { POST as ask } from '@/app/api/ai/agent/route'
import { POST as stream } from '@/app/api/ai/agent/stream/route'
import { POST as transcribe } from '@/app/api/ai/agent/transcribe/route'

const SESSION = { id: 3, agencyId: 7, role: 'ADMIN' }
const VARS = ['AI_ENABLED', 'AGENT_AGENCY_IDS', 'AGENT_AUDIENCE', 'AGENT_EXCLUDED_AGENCY_IDS']
const WEBM = (() => {
  const b = new Uint8Array(4_096)
  b.set([0x1a, 0x45, 0xdf, 0xa3])
  return b
})()

function env(vars: Record<string, string>) {
  for (const k of VARS) delete process.env[k]
  Object.assign(process.env, vars)
  _resetAiEnvCacheForTests()
}

const json = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Every surface, each with a body that also names a different agency — which must never matter. */
const SURFACES = [
  ['ask', () => ask(json('/api/ai/agent', { question: 'q', agencyId: 1 })), () => askAgent],
  ['stream', () => stream(json('/api/ai/agent/stream', { question: 'q', agencyId: 1 })), () => askAgent],
  [
    'transcribe',
    () =>
      transcribe(
        new NextRequest('http://localhost/api/ai/agent/transcribe?agencyId=1', {
          method: 'POST',
          headers: { 'content-type': 'audio/webm;codecs=opus' },
          body: WEBM,
        }),
      ),
    () => admitAiRun, // the first step past the rollout gate
  ],
] as const

async function outcomes() {
  const out: Record<string, { status: number; passedGate: boolean }> = {}
  for (const [name, call, downstream] of SURFACES) {
    askAgent.mockClear()
    admitAiRun.mockClear()
    const res = await call()
    out[name] = { status: res.status, passedGate: downstream().mock.calls.length > 0 }
    await res.text().catch(() => undefined)
  }
  return out
}
const refusedEverywhere = { status: 404, passedGate: false }

beforeEach(() => {
  requireProductAccess.mockReset().mockResolvedValue(SESSION)
  access.mockReset().mockResolvedValue({ status: 'PAID', hasAccess: true })
  askAgent.mockReset().mockResolvedValue({ ok: false, reason: 'error', message: 'x' })
  admitAiRun.mockReset().mockResolvedValue({ ok: false, reason: 'forbidden' })
  transcribeVoice.mockReset()
})
afterEach(() => env({}))

describe('ask, stream and transcribe agree on who may use the Agent', () => {
  it('session agency allowlisted: every surface lets the request past the rollout gate', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '7' })
    for (const [name, o] of Object.entries(await outcomes())) {
      expect({ name, passedGate: o.passedGate }).toEqual({ name, passedGate: true })
      expect(o.status).not.toBe(404)
    }
  })

  it.each([
    ['not on the list', { AI_ENABLED: '1', AGENT_AGENCY_IDS: '1' }],
    ['excluded while allowlisted', { AI_ENABLED: '1', AGENT_AGENCY_IDS: '7', AGENT_EXCLUDED_AGENCY_IDS: '7' }],
    ['excluded under AGENT_AGENCY_IDS=all', { AI_ENABLED: '1', AGENT_AGENCY_IDS: 'all', AGENT_EXCLUDED_AGENCY_IDS: '7' }],
    ['excluded under AGENT_AUDIENCE=all', { AI_ENABLED: '1', AGENT_AUDIENCE: 'all', AGENT_EXCLUDED_AGENCY_IDS: '7' }],
    ['an unknown AGENT_AUDIENCE', { AI_ENABLED: '1', AGENT_AGENCY_IDS: '7', AGENT_AUDIENCE: 'everyone' }],
    ['AI disabled', { AGENT_AGENCY_IDS: '7' }],
  ])('%s: every surface refuses with the same 404', async (_label, vars) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    env(vars)
    expect(await outcomes()).toEqual({ ask: refusedEverywhere, stream: refusedEverywhere, transcribe: refusedEverywhere })
    warn.mockRestore()
  })

  it('a lapsed agency still on the list is refused everywhere by the shared decision', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '7' })
    access.mockResolvedValue({ status: 'TRIAL_EXPIRED', hasAccess: false })
    expect(await outcomes()).toEqual({ ask: refusedEverywhere, stream: refusedEverywhere, transcribe: refusedEverywhere })
  })

  it('the decision reads the session agency only — a body naming an allowlisted agency changes nothing', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '1' }) // the bodies name agency 1; the session is agency 7
    expect(await outcomes()).toEqual({ ask: refusedEverywhere, stream: refusedEverywhere, transcribe: refusedEverywhere })
    expect(access).not.toHaveBeenCalledWith(1)
  })
})
