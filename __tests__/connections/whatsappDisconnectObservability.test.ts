/**
 * WhatsApp disconnect observability.
 *
 * Production agency 130 connected WhatsApp, took real inbound traffic, produced
 * a real lead — then the connection row vanished with no event, no audit row and
 * no timestamp. These tests pin the record that closes that gap, and pin the
 * guarantee that closing it never leaks a credential.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tables: [] as string[],
  wheres: [] as unknown[],
  firstCols: [] as unknown[],
  row: undefined as unknown,
  deleted: 1 as number,
  tracked: [] as { event: string; props?: Record<string, unknown>; agencyId?: number; userId?: number }[],
}))

vi.mock('@/config/db', () => ({
  db: (table: string) => {
    h.tables.push(table)
    return {
      where: (arg: unknown) => {
        h.wheres.push(arg)
        return {
          first: async (...cols: unknown[]) => {
            h.firstCols = cols
            return h.row
          },
          delete: async () => h.deleted,
        }
      },
    }
  },
}))
vi.mock('@/lib/whatsapp/connectionToken', () => ({ resolveWhatsappAccessToken: (t: string) => t }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(async (a: never) => {
    h.tracked.push(a)
  }),
}))

import { getUser } from '@/db/auth'
import { POST } from '@/app/api/auth/whatsapp/disconnect/route'

beforeEach(() => {
  h.tables = []
  h.wheres = []
  h.firstCols = []
  h.deleted = 1
  h.row = { id: 77, waba_id: 'waba_1', onboarding_type: 'embedded_signup', health_status: 'operational', created_at: new Date() }
  h.tracked = []
  // Phase 2 gave the integration routes an admin boundary. This suite covers
  // connect/disconnect MECHANICS, so the fixture now represents a caller who is
  // permitted to reach them; authorization itself is covered separately in
  // __tests__/connections/phase2AuthorizationBoundaries.test.ts.
  vi.mocked(getUser).mockResolvedValue({ id: 99, agencyId: 23, role: 'ADMIN', email: 'x@example.com' } as never)
})

describe('user-initiated WhatsApp disconnect', () => {
  it('emits whatsapp_disconnected exactly once', async () => {
    await POST({} as never)
    const events = h.tracked.filter((t) => t.event === 'whatsapp_disconnected')
    expect(events).toHaveLength(1)
  })

  it('records who, where and what was removed', async () => {
    await POST({} as never)
    const e = h.tracked.find((t) => t.event === 'whatsapp_disconnected')!
    expect(e.agencyId).toBe(23)
    expect(e.userId).toBe(99)
    expect(e.props).toMatchObject({
      source: 'settings_disconnect',
      initiator: 'user',
      deletedCount: 1,
      connectionId: 77,
      hadWaba: true,
      onboardingType: 'embedded_signup',
      healthStatus: 'operational',
    })
  })

  it('distinguishes user-initiated from system-initiated', async () => {
    await POST({} as never)
    const e = h.tracked.find((t) => t.event === 'whatsapp_disconnected')!
    expect(e.props?.initiator).toBe('user')
  })

  it('never puts a credential or customer number in props', async () => {
    h.row = {
      id: 77,
      waba_id: 'waba_1',
      onboarding_type: 'embedded_signup',
      health_status: 'operational',
      created_at: new Date(),
      access_token: 'SECRET_TOKEN_VALUE',
      phone_number_id: '15551234567',
    }
    await POST({} as never)
    const e = h.tracked.find((t) => t.event === 'whatsapp_disconnected')!
    const serialized = JSON.stringify(e.props)
    expect(serialized).not.toMatch(/SECRET_TOKEN_VALUE/)
    expect(serialized).not.toMatch(/15551234567/)
    expect(e.props).not.toHaveProperty('access_token')
    expect(e.props).not.toHaveProperty('phone_number_id')
  })

  it('reads the audit row BEFORE the delete, or there would be nothing to read', async () => {
    await POST({} as never)
    expect(h.firstCols).toEqual(['id', 'waba_id', 'onboarding_type', 'health_status', 'created_at'])
    expect(h.firstCols).not.toContain('access_token')
  })

  it('still deletes, agency-scoped, and still returns ok', async () => {
    const res = await POST({} as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(h.tables).toContain('whatsapp_connections')
    expect(h.wheres).toContainEqual({ agency_id: 23 })
    expect(JSON.stringify(h.wheres)).not.toMatch(/user_id/)
  })

  it('records a no-op disconnect honestly when no connection exists', async () => {
    h.row = undefined
    h.deleted = 0
    await POST({} as never)
    const e = h.tracked.find((t) => t.event === 'whatsapp_disconnected')!
    expect(e.props).toMatchObject({ deletedCount: 0, connectionId: null, hadWaba: false })
  })

  it('emits nothing when the caller is unauthorized', async () => {
    vi.mocked(getUser).mockResolvedValue(null as never)
    const res = await POST({} as never)
    expect(res.status).toBe(401)
    expect(h.tracked).toHaveLength(0)
  })
})
