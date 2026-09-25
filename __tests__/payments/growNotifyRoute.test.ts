import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const hoisted = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[] }))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => void hoisted.tasks.push(Promise.resolve().then(fn)) }
})
vi.mock('@/lib/payments/cardTrial/confirmCardSetup', () => ({ confirmCardSetup: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(async () => {}) }))
vi.mock('@/lib/emailAutomations/live', () => ({ dispatchLifecycleEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/emailAutomations/recipients', () => ({ agencyOwner: vi.fn(async () => ({ userId: 5, agencyId: 9, email: 'o@example.com', firstName: 'O' })) }))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/payments/grow/notify/route'
import { confirmCardSetup } from '@/lib/payments/cardTrial/confirmCardSetup'
import { track } from '@/lib/analytics/track'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'

const SECRET_VALUES = { processId: '462950', processToken: 'e2202e3c-secret', cardToken: 'ct-secret-value', statusCode: '11', sum: '1', cField1: 'ref-1' }
const form = (fields: Record<string, string> = SECRET_VALUES) =>
  new NextRequest('https://staging.example.com/api/payments/grow/notify', {
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })

beforeEach(() => {
  vi.stubEnv('APP_ENV', 'staging')
  vi.stubEnv('GROW_MODE', 'sandbox')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
  vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
  vi.mocked(confirmCardSetup).mockReset()
  vi.mocked(track).mockClear()
  vi.mocked(dispatchLifecycleEvent).mockClear()
  hoisted.tasks.length = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/payments/grow/notify', () => {
  it('refuses to run where Grow calls are not allowed (e.g. a production-backed preview) and asks for a retry', async () => {
    vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', '')
    expect((await POST(form())).status).toBe(503)
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('GROW_MODE', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await POST(form())).status).toBe(503)
    expect(confirmCardSetup).not.toHaveBeenCalled()
  })

  it('passes the parsed form callback and the runtime mode to confirmCardSetup', async () => {
    vi.mocked(confirmCardSetup).mockResolvedValue({ kind: 'confirmed', agencyId: 9, purpose: 'trial_start', createdByUserId: 5, trialStarted: true })
    const res = await POST(form())
    expect(res.status).toBe(200)
    const [callback, deps] = vi.mocked(confirmCardSetup).mock.calls[0]
    expect(callback).toMatchObject({ processId: '462950', processToken: 'e2202e3c-secret', cardToken: 'ct-secret-value', reference: 'ref-1' })
    expect(deps.runtimeMode()).toBe('sandbox')
  })

  it('records card_setup_confirmed and a verified trial_started with no sensitive props', async () => {
    vi.mocked(confirmCardSetup).mockResolvedValue({ kind: 'confirmed', agencyId: 9, purpose: 'trial_start', createdByUserId: 5, trialStarted: true })
    await POST(form())
    await Promise.all(hoisted.tasks)
    expect(track).toHaveBeenCalledWith({ agencyId: 9, userId: 5, event: 'card_setup_confirmed', props: { purpose: 'trial_start' } })
    expect(track).toHaveBeenCalledWith({ agencyId: 9, userId: 5, event: 'trial_started', props: { cardRequired: true } })
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toMatch(/secret|462950|ref-1/)
  })

  it('sends the card-trial activation email, never the no-card one', async () => {
    vi.mocked(confirmCardSetup).mockResolvedValue({ kind: 'confirmed', agencyId: 9, purpose: 'trial_start', createdByUserId: 5, trialStarted: true })
    await POST(form())
    await Promise.all(hoisted.tasks)
    expect(dispatchLifecycleEvent).toHaveBeenCalledWith('trial.card_started', expect.objectContaining({ userId: 5 }), expect.any(Date))
    expect(vi.mocked(dispatchLifecycleEvent).mock.calls.map((c) => c[0])).not.toContain('trial.started')
  })

  it('does not record trial_started when no trial started', async () => {
    vi.mocked(confirmCardSetup).mockResolvedValue({ kind: 'confirmed', agencyId: 9, purpose: 'card_update', createdByUserId: 5, trialStarted: false })
    await POST(form())
    await Promise.all(hoisted.tasks)
    expect(vi.mocked(track).mock.calls.map((c) => c[0].event)).toEqual(['card_setup_confirmed'])
  })

  it('records a refused card as a callback-stage failure with an enum reason', async () => {
    vi.mocked(confirmCardSetup).mockResolvedValue({ kind: 'refused', agencyId: 9, reason: 'unexpected_status' })
    expect((await POST(form())).status).toBe(200)
    await Promise.all(hoisted.tasks)
    expect(track).toHaveBeenCalledWith({ agencyId: 9, event: 'card_setup_failed', props: { stage: 'callback', reason: 'unexpected_status' } })
  })

  it.each([
    [{ kind: 'rejected', httpStatus: 401, reason: 'process_token_mismatch' }, 401],
    [{ kind: 'rejected', httpStatus: 400, reason: 'missing_fields' }, 400],
    [{ kind: 'retry_later', agencyId: 9, reason: 'transport_error' }, 503],
    [{ kind: 'awaiting_evidence', agencyId: 9 }, 200],
    [{ kind: 'already_processed', agencyId: 9, status: 'active' }, 200],
  ] as const)('maps %o to HTTP %i', async (outcome, status) => {
    vi.mocked(confirmCardSetup).mockResolvedValue(outcome as never)
    expect((await POST(form())).status).toBe(status)
  })

  it('answers 500 when processing throws, so Grow retries', async () => {
    vi.mocked(confirmCardSetup).mockRejectedValue(new Error('db down'))
    expect((await POST(form())).status).toBe(500)
  })

  it.each([
    ['JSON', JSON.stringify({ data: SECRET_VALUES }), 'application/json', 415],
    ['conflicting shapes', 'processId=1&data%5BprocessId%5D=2', 'application/x-www-form-urlencoded', 400],
  ])('refuses %s before any processing', async (_label, body, contentType, status) => {
    const req = new NextRequest('https://staging.example.com/api/payments/grow/notify', { method: 'POST', body, headers: { 'content-type': contentType } })
    expect((await POST(req)).status).toBe(status)
    expect(confirmCardSetup).not.toHaveBeenCalled()
  })

  it('logs key names, never values', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(confirmCardSetup).mockResolvedValue({ kind: 'awaiting_evidence', agencyId: 9 })
    await POST(form())
    expect(JSON.stringify(log.mock.calls)).toContain('cardToken')
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret/)
  })
})
