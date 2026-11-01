/**
 * POST /api/ai/agent — the Agent's only caller-facing surface.
 *
 * The route is transport, and these tests hold it to that: it decides who may
 * ask and what a question is, then hands the question — and nothing else — to
 * the existing `askAgent` path. Everything that decides WHAT the Agent may see
 * (agency, permissions, entitlement, budget, model) is resolved server-side
 * below this layer and is unreachable from the request body.
 *
 * The body-injection tests are the point of this file. A route that quietly
 * forwarded `investigationId` would let one client overwrite another's history
 * row, since persistence is first-write-wins; one that forwarded `deadlineMs`
 * or `maxSteps` would defeat the budget. So the assertion is not "the extra
 * field was ignored" but "askAgent was called with exactly the question".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const askAgent = vi.hoisted(() => vi.fn())
const requireProductAccess = vi.hoisted(() => vi.fn())
const isAgentEnabled = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/actions/ai/askAgent', () => ({ askAgent }))
vi.mock('@/lib/ai/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/flags')>()
  return { ...actual, isAgentEnabled }
})
vi.mock('@/lib/requireUser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/requireUser')>()
  return { ...actual, requireProductAccess }
})

import { NextRequest } from 'next/server'
import { AuthError, ProductAccessError } from '@/lib/requireUser'
import { POST, maxDuration } from '@/app/api/ai/agent/route'

const USER = { id: 3, agencyId: 7 }
const OK_RESULT = {
  ok: true as const,
  answer: { headline: 'ליד אחד ממתין.', claims: [{ claimClass: 'FACT', text: 'דוד ממתין.', entityEvidence: ['42'] }], unknown: null },
  evidence: [{ kind: 'lead', refId: '42' }],
  steps: 1,
  stopReason: 'answered' as const,
  investigationId: 'inv_abc123',
}

function post(body: unknown, opts: { raw?: string; signal?: AbortSignal } = {}) {
  return new NextRequest('http://localhost/api/ai/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: opts.raw !== undefined ? opts.raw : JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
}

beforeEach(() => {
  askAgent.mockReset().mockResolvedValue(OK_RESULT)
  requireProductAccess.mockReset().mockResolvedValue(USER)
  isAgentEnabled.mockReset().mockReturnValue(true)
})

// ── Runtime ───────────────────────────────────────────────────────────────────

describe('runtime configuration', () => {
  it('declares the repository 60s convention for long work', () => {
    // The Agent budget is 40s; a route that declares nothing inherits the
    // platform default and can be cut off mid-investigation.
    expect(maxDuration).toBe(60)
  })
})

// ── Authorization ─────────────────────────────────────────────────────────────

describe('authorization', () => {
  it('an unauthenticated request is 401 and never reaches the Agent', async () => {
    requireProductAccess.mockRejectedValue(new AuthError('no_session'))
    const res = await POST(post({ question: 'q' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(askAgent).not.toHaveBeenCalled()
  })

  it.each([
    ['subscription-required'],
    ['trial-not-started'],
  ])('a lapsed subscription is 403 carrying the existing reason (%s)', async (reason) => {
    requireProductAccess.mockRejectedValue(new ProductAccessError(reason as 'subscription-required'))
    const res = await POST(post({ question: 'q' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: reason })
    expect(askAgent).not.toHaveBeenCalled()
  })

  it('an agency outside the Agent allowlist is 404 and never reaches the Agent', async () => {
    isAgentEnabled.mockReturnValue(false)
    const res = await POST(post({ question: 'q' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'agent-disabled' })
    expect(askAgent).not.toHaveBeenCalled()
  })

  it('an excluded agency is 404 even while allowlisted — the same decision the page, nav and WhatsApp use', async () => {
    process.env.AGENT_EXCLUDED_AGENCY_IDS = '7'
    try {
      const res = await POST(post({ question: 'q' }))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'agent-disabled' })
      expect(askAgent).not.toHaveBeenCalled()
    } finally {
      delete process.env.AGENT_EXCLUDED_AGENCY_IDS
    }
  })

  it('gates on the agency from the session, never from the body', async () => {
    await POST(post({ question: 'q', agencyId: 999 }))
    expect(isAgentEnabled).toHaveBeenCalledWith(7)
  })
})

// ── Input ─────────────────────────────────────────────────────────────────────

describe('input validation', () => {
  it('rejects malformed JSON with 400', async () => {
    const res = await POST(post(null, { raw: '{not json' }))
    expect(res.status).toBe(400)
    expect(askAgent).not.toHaveBeenCalled()
  })

  it('rejects a missing question with 400', async () => {
    expect((await POST(post({}))).status).toBe(400)
    expect(askAgent).not.toHaveBeenCalled()
  })

  it.each([[42], [null], [{ a: 1 }], [['q']], [true]])('rejects a non-string question (%s) with 400', async (q) => {
    expect((await POST(post({ question: q }))).status).toBe(400)
    expect(askAgent).not.toHaveBeenCalled()
  })

  it('rejects a blank question with 400', async () => {
    expect((await POST(post({ question: '   ' }))).status).toBe(400)
    expect(askAgent).not.toHaveBeenCalled()
  })
})

// ── The body cannot reach authority ───────────────────────────────────────────

describe('the request body controls nothing but the question', () => {
  it('passes exactly the question through', async () => {
    await POST(post({ question: 'מה דורש טיפול?' }))
    expect(askAgent).toHaveBeenCalledTimes(1)
    expect(askAgent.mock.calls[0]![0]).toBe('מה דורש טיפול?')
  })

  it.each([
    ['agencyId', { agencyId: 999 }],
    ['userId', { userId: 999 }],
    ['investigationId', { investigationId: 'inv_ATTACKER' }],
    ['deadlineMs', { deadlineMs: 900_000 }],
    ['maxSteps', { maxSteps: 9999 }],
    ['model', { model: 'evil-model' }],
    ['evidence', { evidence: [{ kind: 'lead', refId: '1' }] }],
    ['onPersist', { onPersist: 'x' }],
  ])('never forwards a body-supplied %s', async (_label, extra) => {
    await POST(post({ question: 'q', ...extra }))
    expect(askAgent).toHaveBeenCalledTimes(1)
    const args = askAgent.mock.calls[0]!
    expect(args[0]).toBe('q')
    // Any second argument must be an AbortSignal — never a caller options bag.
    for (const arg of args.slice(1)) {
      expect(arg === undefined || arg instanceof AbortSignal).toBe(true)
    }
    expect(JSON.stringify(args)).not.toContain('inv_ATTACKER')
    expect(JSON.stringify(args)).not.toContain('999')
    expect(JSON.stringify(args)).not.toContain('9999')
  })
})

// ── Response contract ─────────────────────────────────────────────────────────

describe('response contract', () => {
  it('passes a successful AgentResult through unchanged, with investigationId', async () => {
    const res = await POST(post({ question: 'q' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(OK_RESULT)
    expect(body.investigationId).toBe('inv_abc123')
  })

  it.each([
    [{ ok: false, reason: 'gate_denied', message: 'over-quota', investigationId: 'inv_1' }],
    [{ ok: false, reason: 'no_evidence', investigationId: 'inv_2' }],
    [{ ok: false, reason: 'error', message: 'provider down', investigationId: 'inv_3' }],
  ])('passes a business failure through as 200 with its typed reason (%o)', async (result) => {
    askAgent.mockResolvedValue(result)
    const res = await POST(post({ question: 'q' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(result)
  })

  it('sets Cache-Control: no-store on every response', async () => {
    for (const setup of [
      () => {},
      () => requireProductAccess.mockRejectedValue(new AuthError('no_session')),
      () => isAgentEnabled.mockReturnValue(false),
    ]) {
      beforeEachReset()
      setup()
      const res = await POST(post({ question: 'q' }))
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
  })
})

function beforeEachReset() {
  askAgent.mockReset().mockResolvedValue(OK_RESULT)
  requireProductAccess.mockReset().mockResolvedValue(USER)
  isAgentEnabled.mockReset().mockReturnValue(true)
}

// ── Failures ──────────────────────────────────────────────────────────────────

describe('failures', () => {
  it('an unexpected exception is 500 and leaks nothing', async () => {
    askAgent.mockRejectedValue(new Error('anthropic key sk-secret-123 rejected'))
    const res = await POST(post({ question: 'q' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'unavailable' })
    expect(JSON.stringify(body)).not.toContain('sk-secret-123')
  })

  it('an unexpected auth-layer exception is 500, not 401', async () => {
    requireProductAccess.mockRejectedValue(new Error('db down'))
    expect((await POST(post({ question: 'q' }))).status).toBe(500)
  })

  it('propagates the request abort signal to the Agent', async () => {
    const ac = new AbortController()
    await POST(post({ question: 'q' }, { signal: ac.signal }))
    expect(askAgent.mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
  })
})
