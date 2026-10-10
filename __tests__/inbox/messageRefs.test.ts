import { describe, expect, it } from 'vitest'
import { mapLeadWhatsappMessageRow } from '@/db/inboxMessages'
import { sanitizeCaption, sanitizeReactionEmoji } from '@/db/inboxMessageRefs'

/**
 * Captions, reactions and reply references in the thread projection: what the
 * browser receives, and what it never receives.
 */

const row = (over: Record<string, unknown>) => ({
  id: '9',
  direction: 'inbound',
  type: 'text',
  text: '',
  payload: {},
  status: 'received',
  errorReason: null,
  channelTimestamp: new Date('2026-10-01T10:00:00.000Z'),
  createdAt: new Date('2026-10-01T10:00:01.000Z'),
  metadata: {},
  sentByUserId: null,
  reactionTargetId: null,
  hasReplyContext: false,
  replyTargetId: null,
  ...over,
})

describe('captions', () => {
  it('image, video and document captions are carried, sanitized; text is unchanged', () => {
    for (const type of ['image', 'video', 'document']) {
      const m = mapLeadWhatsappMessageRow(row({ type, payload: { id: 'media1', mime_type: 'image/jpeg', caption: '  מחיר\nלחבילה\u0007  ' } }))
      expect(m.caption).toBe('מחיר\nלחבילה')
      expect(m.text).toBe('')
    }
  })

  it('audio and stickers have no caption; an empty caption is absent', () => {
    expect(sanitizeCaption('audio', { caption: 'x' })).toBeNull()
    expect(sanitizeCaption('sticker', { caption: 'x' })).toBeNull()
    expect('caption' in mapLeadWhatsappMessageRow(row({ type: 'image', payload: { id: 'm', caption: '   ' } }))).toBe(false)
  })

  it('is bounded to 1024 characters', () => {
    expect(sanitizeCaption('image', { caption: 'א'.repeat(2000) })).toHaveLength(1024)
  })
})

describe('reactions', () => {
  it('carry the emoji and our own target row id', () => {
    const m = mapLeadWhatsappMessageRow(row({ type: 'reaction', payload: { message_id: 'wamid.X', emoji: '👍' }, reactionTargetId: '41' }))
    expect(m.reaction).toEqual({ emoji: '👍', targetId: 41, targetRef: null })
  })

  it('a removed reaction (emoji omitted by WhatsApp) has a null emoji', () => {
    const m = mapLeadWhatsappMessageRow(row({ type: 'reaction', payload: { message_id: 'wamid.X' }, reactionTargetId: '41' }))
    expect(m.reaction).toEqual({ emoji: null, targetId: 41, targetRef: null })
  })

  it('an unmatched target stays null; nothing is guessed', () => {
    expect(mapLeadWhatsappMessageRow(row({ type: 'reaction', payload: { message_id: 'wamid.Y', emoji: '❤️' } })).reaction).toEqual({ emoji: '❤️', targetId: null, targetRef: null })
  })

  it('carries the opaque target ref computed in SQL, never the WhatsApp id', () => {
    const m = mapLeadWhatsappMessageRow(row({ type: 'reaction', payload: { message_id: 'wamid.X', emoji: '👍' }, reactionTargetRef: 'abcdef0123456789' }))
    expect(m.reaction?.targetRef).toBe('abcdef0123456789')
    expect(JSON.stringify(m)).not.toContain('wamid.')
  })

  it('an emoji with control characters is cleaned; an implausibly long one is dropped', () => {
    expect(sanitizeReactionEmoji({ emoji: '👍\u0000' })).toBe('👍')
    expect(sanitizeReactionEmoji({ emoji: 'x'.repeat(40) })).toBeNull()
    expect(sanitizeReactionEmoji({ emoji: 5 })).toBeNull()
  })

  it('non-reaction rows carry no reaction', () => {
    expect('reaction' in mapLeadWhatsappMessageRow(row({ type: 'text', text: 'שלום' }))).toBe(false)
  })
})

describe('reply references', () => {
  it('a reply carries the quoted row id, or null when it is not in the thread', () => {
    expect(mapLeadWhatsappMessageRow(row({ hasReplyContext: true, replyTargetId: '7' })).replyTo).toEqual({ targetId: 7 })
    expect(mapLeadWhatsappMessageRow(row({ hasReplyContext: true })).replyTo).toEqual({ targetId: null })
  })

  it('no reply context, no replyTo', () => {
    expect('replyTo' in mapLeadWhatsappMessageRow(row({}))).toBe(false)
  })
})

describe('what the browser never receives', () => {
  it('no external message ids, raw payloads or media ids in the projection', () => {
    const m = mapLeadWhatsappMessageRow(
      row({ type: 'image', externalId: 'wamid.SECRET', rawPayload: { context: { id: 'wamid.Q' } }, payload: { id: 'MEDIA_ID', caption: 'c', url: 'https://x' }, hasReplyContext: true, replyTargetId: '3' }),
    )
    const json = JSON.stringify(m)
    expect(json).not.toContain('wamid.')
    expect(json).not.toContain('MEDIA_ID')
    expect(json).not.toContain('https://x')
    expect(Object.keys(m)).not.toContain('payload')
    expect(Object.keys(m)).not.toContain('rawPayload')
  })
})
