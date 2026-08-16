import { describe, expect, it } from 'vitest'
import { lastHumanOutboundSubquery, waitingReplySql } from '@/lib/inbox/waitingReplySql'
import { oldestWaitingWhatsappQuery } from '@/db/inboxWaiting'
import { AUTO_RESPONSE_SOURCE, PROMISED_WAITING_RECENCY_DAYS } from '@/lib/today/constants'
import { Roles } from '@/types/roles'

describe('waiting SQL reuses the human-outbound marker', () => {
  it('excludes IRE / auto_response from last human outbound', () => {
    const sql = lastHumanOutboundSubquery('cv.id').toLowerCase()
    expect(sql).toContain("metadata->>'source') is distinct from")
    expect(sql).toContain(`'${AUTO_RESPONSE_SOURCE}'`)
    expect(sql).not.toContain('sentbyuserid')
  })

  it('waiting predicate uses inbound newer than human outbound + existing recency', () => {
    const sql = waitingReplySql('cv').toLowerCase()
    expect(sql).toContain('lastinboundat')
    expect(sql).toContain('-infinity')
    expect(sql).toContain(`${PROMISED_WAITING_RECENCY_DAYS} days`)
  })

  it('oldest waiter query is WhatsApp + lead-scoped and excludes terminals / leadless', () => {
    const sql = oldestWaitingWhatsappQuery({
      agencyId: 3,
      user: { role: Roles.AGNT },
      gotPermIds: [7],
      plan: 'pro',
    })
      .toString()
      .toLowerCase()
    expect(sql).toContain('whatsapp')
    expect(sql).toContain('"leadid" is not null')
    expect(sql).toContain('"lead" =')
    expect(sql).toMatch(/"status" not in/)
    expect(sql).toContain("'closed'")
    expect(sql).toContain('userid')
    expect(sql).toContain("metadata->>'source') is distinct from 'auto_response'")
  })
})
