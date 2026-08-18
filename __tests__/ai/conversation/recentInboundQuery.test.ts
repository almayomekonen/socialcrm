import { describe, expect, it } from 'vitest'
import { recentWhatsappInboundQuery } from '@/lib/copilot/general/recentInboundQuery'
import { oldestWaitingWhatsappQuery } from '@/db/inboxWaiting'
import { Roles } from '@/types/roles'

const opts = {
  agencyId: 3,
  user: { role: Roles.AGNT },
  gotPermIds: [7],
  plan: 'pro',
}

describe('recent vs waiting inbound SQL', () => {
  it('recent inbound is WhatsApp + lastInboundAt, without the waiting-reply predicate', () => {
    const sql = recentWhatsappInboundQuery(opts).toString().toLowerCase()
    expect(sql).toContain('whatsapp')
    expect(sql).toContain('lastinboundat')
    expect(sql).toContain('"lead" =')
    expect(sql).not.toContain('-infinity')
    expect(sql).not.toContain('auto_response')
  })

  it('waiting inbound still requires inbound newer than human outbound', () => {
    const sql = oldestWaitingWhatsappQuery(opts).toString().toLowerCase()
    expect(sql).toContain('whatsapp')
    expect(sql).toContain('-infinity')
    expect(sql).toContain('auto_response')
  })
})
