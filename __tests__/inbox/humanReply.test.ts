/**
 * "Did a person answer?" — the one rule the reminder, the reply-cancel hook and
 * the conversation header share (lib/inbox/humanReply.ts).
 */
import { describe, expect, it } from 'vitest'
import { ECHO_SOURCE, humanOutboundSql, isHumanOutbound, lastCountedDirection } from '@/lib/inbox/humanReply'
import { ECHO_SOURCE as WRITTEN_ECHO_SOURCE } from '@/lib/inbox/ingestWhatsappEcho'

describe('isHumanOutbound', () => {
  it('a reply from SocialCRM (a user, no source) is a person', () => {
    expect(isHumanOutbound({ source: null, sentByUserId: 5 })).toBe(true)
  })

  it('a reply from the WhatsApp Business app (Coexistence echo) is a person', () => {
    expect(isHumanOutbound({ source: 'smb_message_echo', sentByUserId: null })).toBe(true)
  })

  it('an AI or questionnaire message is not, even though it carries the owner’s user id', () => {
    expect(isHumanOutbound({ source: 'auto_response', sentByUserId: 5 })).toBe(false)
  })

  it('an automation send (no user, no source) and imported history are not', () => {
    expect(isHumanOutbound({ source: null, sentByUserId: null })).toBe(false)
    expect(isHumanOutbound({ source: 'whatsapp_history', sentByUserId: 5 })).toBe(false)
  })

  it('a failed send is not an answer', () => {
    expect(isHumanOutbound({ source: null, sentByUserId: 5, status: 'failed' })).toBe(false)
    expect(isHumanOutbound({ source: 'smb_message_echo', sentByUserId: null, status: 'failed' })).toBe(false)
  })

  it('the echo marker is the one the echo ingester writes', () => {
    expect(ECHO_SOURCE).toBe(WRITTEN_ECHO_SOURCE)
  })

  it('the SQL twin states the same rule', () => {
    const sql = humanOutboundSql('h')
    expect(sql).toContain(`(h.metadata->>'source') = 'smb_message_echo'`)
    expect(sql).toContain(`(h.metadata->>'source') IS NULL AND h."sentByUserId" IS NOT NULL`)
    expect(sql).toContain(`h.status IS DISTINCT FROM 'failed'`)
    expect(sql).toContain(`IS DISTINCT FROM 'whatsapp_history'`)
  })
})

describe('lastCountedDirection — the header chip', () => {
  it('an AI reply after the customer does not read as "the rep replied"', () => {
    expect(
      lastCountedDirection([
        { direction: 'inbound' },
        { direction: 'outbound', byPerson: false },
      ]),
    ).toBe('inbound')
  })

  it('a person’s reply does', () => {
    expect(
      lastCountedDirection([
        { direction: 'inbound' },
        { direction: 'outbound', byPerson: false },
        { direction: 'outbound', byPerson: true },
      ]),
    ).toBe('outbound')
  })

  it('rows that do not say count as before, and an empty thread has no chip', () => {
    expect(lastCountedDirection([{ direction: 'inbound' }, { direction: 'outbound' }])).toBe('outbound')
    expect(lastCountedDirection([])).toBeNull()
  })
})
