/**
 * Agency-scoped WhatsApp connection lookup and disconnect.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  lastWhere: null as unknown,
  lastTable: '' as string,
}))

vi.mock('@/config/db', () => ({
  db: (table: string) => {
    h.lastTable = table
    return {
      where: (arg: unknown) => {
        h.lastWhere = arg
        return {
          first: async () => ({ id: 1, agency_id: 23 }),
          delete: async () => 1,
        }
      },
    }
  },
}))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))

import { getUser } from '@/db/auth'
import { getWhatsappConnectionState } from '@/db/whatsapp'
import { POST } from '@/app/api/auth/whatsapp/disconnect/route'

beforeEach(() => {
  h.lastWhere = null
  h.lastTable = ''
  vi.mocked(getUser).mockResolvedValue({ id: 99, agencyId: 23, email: 'x@example.com' } as never)
})

describe('agency-scoped WhatsApp connection', () => {
  it('getWhatsappConnectionState looks up agency_id, not user_id', async () => {
    await getWhatsappConnectionState(23)
    expect(h.lastTable).toBe('whatsapp_connections')
    expect(h.lastWhere).toEqual({ agency_id: 23 })
    expect(h.lastWhere).not.toEqual({ user_id: 99 })
  })

  it('disconnect deletes by agency_id, not user_id', async () => {
    const res = await POST({} as never)
    expect(res.status).toBe(200)
    expect(h.lastTable).toBe('whatsapp_connections')
    expect(h.lastWhere).toEqual({ agency_id: 23 })
    expect(JSON.stringify(h.lastWhere)).not.toMatch(/user_id/)
  })
})
