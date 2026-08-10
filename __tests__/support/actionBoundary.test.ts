import { test, expect, vi, beforeEach } from 'vitest'

const requireAgencyUser = vi.fn()
const createSupportRequestSystem = vi.fn()
const countRequestsByUserSince = vi.fn()
const getSupportRequestSystem = vi.fn()
const appendSupportMessageSystem = vi.fn()

vi.mock('@/lib/requireUser', () => ({ requireAgencyUser }))
vi.mock('@/db/support/requests', () => ({
  createSupportRequestSystem,
  countRequestsByUserSince,
  getSupportRequestSystem,
}))
vi.mock('@/db/support/messages', () => ({ appendSupportMessageSystem }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'user-agent' ? 'Chrome/120' : null) }),
}))
vi.mock('@/lib/quota', () => ({ getAgencyPlan: async () => 'pro' }))
vi.mock('@/db/trial', () => ({ getAgencyTrial: async () => null }))
vi.mock('@/lib/trial', () => ({ getTrialState: () => ({ status: 'PAID', daysRemaining: null }) }))

const SESSION = {
  id: 5,
  agencyId: 101,
  role: 'AGNT',
  email: 'rep@abc.co.il',
  name: 'דנה לוי',
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAgencyUser.mockResolvedValue({ ...SESSION })
  countRequestsByUserSince.mockResolvedValue(0)
  createSupportRequestSystem.mockResolvedValue({ requestId: 77 })
})

const valid = {
  subject: 'WhatsApp לא מתחבר',
  category: 'whatsapp',
  body: 'ניסיתי לחבר מחדש ולא עבד',
  kind: 'problem',
  clientRoute: '/settings/integrations',
}

// --- session identity ---

test('agencyId and userId come from the session; client-supplied values are ignored', async () => {
  const { createSupportRequestAction } = await import('@/actions/support/requests')
  await createSupportRequestAction({
    ...valid,
    // Hostile input: both must be ignored entirely.
    agencyId: 999,
    createdByUserId: 999,
  } as any)

  const passed = createSupportRequestSystem.mock.calls[0][0]
  expect(passed.agencyId).toBe(101)
  expect(passed.createdByUserId).toBe(5)
})

test('the requester snapshot is taken from the session, not the wire', async () => {
  const { createSupportRequestAction } = await import('@/actions/support/requests')
  await createSupportRequestAction({
    ...valid,
    requesterEmail: 'attacker@evil.com',
    requesterName: 'someone else',
  } as any)
  const passed = createSupportRequestSystem.mock.calls[0][0]
  expect(passed.requesterEmail).toBe('rep@abc.co.il')
  expect(passed.requesterName).not.toBe('someone else')
})

// --- validation and rate limiting happen BEFORE any write ---

test('an over-cap user is refused before anything is written', async () => {
  countRequestsByUserSince.mockResolvedValue(10)
  const { createSupportRequestAction } = await import('@/actions/support/requests')
  const res = await createSupportRequestAction(valid as any)
  expect(res).toEqual({ ok: false, reason: 'rate_limited' })
  expect(createSupportRequestSystem).not.toHaveBeenCalled()
})

test('an invalid category is refused with a typed code, not a throw', async () => {
  const { createSupportRequestAction } = await import('@/actions/support/requests')
  const res = await createSupportRequestAction({ ...valid, category: 'wallet' } as any)
  expect(res).toEqual({ ok: false, reason: 'invalid_category' })
  expect(createSupportRequestSystem).not.toHaveBeenCalled()
})

test('an empty body with NO resolved context is refused (three-layer contract)', async () => {
  const { createSupportRequestAction } = await import('@/actions/support/requests')
  const res = await createSupportRequestAction({ ...valid, body: '' } as any)
  expect(res).toEqual({ ok: false, reason: 'invalid_body' })
  expect(createSupportRequestSystem).not.toHaveBeenCalled()
})

// --- context is never a client payload ---

test('the persisted context is {} in phase 1 and never a client-supplied payload', async () => {
  const { createSupportRequestAction } = await import('@/actions/support/requests')
  await createSupportRequestAction({
    ...valid,
    context: { kind: 'integration', facts: [{ label: 'x', value: 'y' }], secretStuff: 'nope' },
  } as any)
  const passed = createSupportRequestSystem.mock.calls[0][0]
  expect(passed.context).toEqual({})
  expect(JSON.stringify(passed.context)).not.toContain('nope')
})

test('clientRoute is stored sanitised and influences nothing else', async () => {
  const { createSupportRequestAction } = await import('@/actions/support/requests')
  await createSupportRequestAction({
    ...valid,
    clientRoute: 'https://evil.example.com/x?ctx=integration:whatsapp:999',
  } as any)
  const passed = createSupportRequestSystem.mock.calls[0][0]
  expect(passed.diagnostics.clientRoute).toBe('')
  expect(passed.agencyId).toBe(101)
  expect(passed.category).toBe('whatsapp')
})

// --- reply path ---

test('replying to another agency request reports not_found, never forbidden', async () => {
  // The scoped read returns nothing, so the caller cannot distinguish "exists
  // but not yours" from "does not exist".
  getSupportRequestSystem.mockResolvedValue(null)
  const { replyToSupportRequestAction } = await import('@/actions/support/requests')
  const res = await replyToSupportRequestAction(9, 'שלום')
  expect(res).toEqual({ ok: false, reason: 'not_found' })
  expect(appendSupportMessageSystem).not.toHaveBeenCalled()
})

test("replying to a colleague's request as a non-admin reports not_found", async () => {
  getSupportRequestSystem.mockResolvedValue({
    id: 9,
    agencyId: 101,
    createdByUserId: 6, // someone else in the same agency
  })
  const { replyToSupportRequestAction } = await import('@/actions/support/requests')
  const res = await replyToSupportRequestAction(9, 'שלום')
  expect(res).toEqual({ ok: false, reason: 'not_found' })
  expect(appendSupportMessageSystem).not.toHaveBeenCalled()
})

test('the reply read is scoped by the session agency', async () => {
  getSupportRequestSystem.mockResolvedValue({ id: 9, agencyId: 101, createdByUserId: 5 })
  appendSupportMessageSystem.mockResolvedValue({ ok: true, messageId: 1, nextStatus: 'open' })
  const { replyToSupportRequestAction } = await import('@/actions/support/requests')
  const res = await replyToSupportRequestAction(9, 'תודה')
  expect(getSupportRequestSystem).toHaveBeenCalledWith({ agencyId: 101, requestId: 9 })
  expect(appendSupportMessageSystem.mock.calls[0][0].agencyId).toBe(101)
  expect(appendSupportMessageSystem.mock.calls[0][0].authorKind).toBe('customer')
  expect(res).toEqual({ ok: true, requestId: 9 })
})

test('an empty reply is refused before any read or write', async () => {
  const { replyToSupportRequestAction } = await import('@/actions/support/requests')
  const res = await replyToSupportRequestAction(9, '   ')
  expect(res).toEqual({ ok: false, reason: 'invalid_body' })
  expect(getSupportRequestSystem).not.toHaveBeenCalled()
  expect(appendSupportMessageSystem).not.toHaveBeenCalled()
})
