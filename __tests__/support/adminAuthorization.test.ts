import { test, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
const isPlatformOwner = vi.fn()
const appendSupportMessageForAdmin = vi.fn()
const setSupportRequestStatusForAdmin = vi.fn()

vi.mock('@/db/auth', () => ({ getUser }))
vi.mock('@/lib/auth/platformOwner', () => ({ isPlatformOwner }))
vi.mock('@/db/support/admin', () => ({
  appendSupportMessageForAdmin,
  setSupportRequestStatusForAdmin,
  listSupportRequestsForAdmin: vi.fn(),
  getSupportRequestForAdmin: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  appendSupportMessageForAdmin.mockResolvedValue({
    ok: true,
    messageId: 1,
    nextStatus: 'waiting_for_customer',
  })
  setSupportRequestStatusForAdmin.mockResolvedValue({ ok: true })
})

test('a workspace ADMIN is refused — role is never the gate', async () => {
  getUser.mockResolvedValue({ id: 7, email: 'admin@abc.co.il', role: 'ADMIN', agencyId: 101 })
  isPlatformOwner.mockReturnValue(false)

  const { replyAsSupportAction, setSupportStatusAction } = await import('@/actions/support/admin')
  expect(await replyAsSupportAction(9, 'שלום')).toEqual({ ok: false, reason: 'forbidden' })
  expect(await setSupportStatusAction(9, 'resolved')).toEqual({ ok: false, reason: 'forbidden' })
  expect(appendSupportMessageForAdmin).not.toHaveBeenCalled()
  expect(setSupportRequestStatusForAdmin).not.toHaveBeenCalled()
})

test('an unauthenticated caller is refused', async () => {
  getUser.mockResolvedValue(null)
  isPlatformOwner.mockReturnValue(false)
  const { replyAsSupportAction } = await import('@/actions/support/admin')
  expect(await replyAsSupportAction(9, 'שלום')).toEqual({ ok: false, reason: 'forbidden' })
  expect(appendSupportMessageForAdmin).not.toHaveBeenCalled()
})

test('the platform owner may reply, and the reply is attributed to their user id', async () => {
  getUser.mockResolvedValue({ id: 42, email: 'owner@getsocialcrm.com', role: 'AGNT', agencyId: 1 })
  isPlatformOwner.mockReturnValue(true)

  const { replyAsSupportAction } = await import('@/actions/support/admin')
  expect(await replyAsSupportAction(9, 'בודקים את זה')).toEqual({ ok: true })

  const passed = appendSupportMessageForAdmin.mock.calls[0][0]
  expect(passed.requestId).toBe(9)
  expect(passed.body).toBe('בודקים את זה')
  // Stored for internal attribution — the customer thread can never render it.
  expect(passed.authorUserId).toBe(42)
})

test('an empty reply is refused before touching the database', async () => {
  getUser.mockResolvedValue({ id: 42, email: 'owner@getsocialcrm.com' })
  isPlatformOwner.mockReturnValue(true)
  const { replyAsSupportAction } = await import('@/actions/support/admin')
  expect(await replyAsSupportAction(9, '   ')).toEqual({ ok: false, reason: 'invalid_body' })
  expect(appendSupportMessageForAdmin).not.toHaveBeenCalled()
})

test('an arbitrary status string is refused and never written', async () => {
  getUser.mockResolvedValue({ id: 42, email: 'owner@getsocialcrm.com' })
  isPlatformOwner.mockReturnValue(true)
  const { setSupportStatusAction } = await import('@/actions/support/admin')
  expect(await setSupportStatusAction(9, 'deleted' as any)).toEqual({ ok: false, reason: 'invalid_status' })
  expect(setSupportRequestStatusForAdmin).not.toHaveBeenCalled()
})

test('a missing request surfaces as not_found, not a throw', async () => {
  getUser.mockResolvedValue({ id: 42, email: 'owner@getsocialcrm.com' })
  isPlatformOwner.mockReturnValue(true)
  appendSupportMessageForAdmin.mockResolvedValue({ reason: 'not_found' })
  const { replyAsSupportAction } = await import('@/actions/support/admin')
  expect(await replyAsSupportAction(999, 'שלום')).toEqual({ ok: false, reason: 'not_found' })
})
