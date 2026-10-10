import { describe, expect, it } from 'vitest'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import { UNSUPPORTED_MESSAGE_NOTICE } from '@/lib/inbox/attachmentDisplay'
import { bubbleMediaLayout, buildThreadEntries, messageBody, quotePreview } from '@/lib/inbox/whatsappThreadView'

/** The shared thread view both the desktop and mobile threads render. */

const msg = (id: number, over: Partial<LeadWhatsappMessage> = {}): LeadWhatsappMessage => ({
  id,
  direction: 'inbound',
  type: 'text',
  text: `הודעה ${id}`,
  timestamp: `2026-10-01T10:00:${String(id).padStart(2, '0')}.000Z`,
  status: 'received',
  failureText: null,
  failureCategory: null,
  attachment: null,
  ...over,
})
const reaction = (id: number, emoji: string | null, target: { id?: number | null; ref?: string | null }, over: Partial<LeadWhatsappMessage> = {}) =>
  msg(id, { type: 'reaction', text: '', reaction: { emoji, targetId: target.id ?? null, targetRef: target.ref ?? null }, ...over })

const kinds = (list: LeadWhatsappMessage[]) => buildThreadEntries(list).map((e) => (e.kind === 'message' ? `m${e.message.id}` : `r:${e.emoji}`))
const on = (list: LeadWhatsappMessage[], id: number) => {
  const e = buildThreadEntries(list).find((x) => x.kind === 'message' && x.message.id === id)
  return e?.kind === 'message' ? e.reactions : undefined
}

describe('reactions', () => {
  it('attach to their message when it is in the thread, and are not entries of their own', () => {
    const list = [msg(1, { direction: 'outbound' }), reaction(2, '👍', { id: 1, ref: 'a' })]
    expect(kinds(list)).toEqual(['m1'])
    expect(on(list, 1)).toEqual([{ emoji: '👍', byBusiness: false }])
  })

  it('a reaction whose message is not in the thread is a compact line of its own', () => {
    expect(kinds([msg(1), reaction(2, '❤️', { ref: 'x' })])).toEqual(['m1', 'r:❤️'])
  })

  it('latest wins per sender and message; a removal (no emoji) removes it', () => {
    expect(on([msg(1), reaction(2, '👍', { id: 1 }), reaction(3, '❤️', { id: 1 })], 1)).toEqual([{ emoji: '❤️', byBusiness: false }])
    expect(on([msg(1), reaction(2, '👍', { id: 1 }), reaction(3, null, { id: 1 })], 1)).toEqual([])
    // Also for a message not in the thread, through the opaque ref.
    expect(kinds([reaction(2, '👍', { ref: 'x' }), reaction(3, '😂', { ref: 'x' })])).toEqual(['r:😂'])
    expect(kinds([reaction(2, '👍', { ref: 'x' }), reaction(3, null, { ref: 'x' })])).toEqual([])
  })

  it('the customer and the business each keep their own reaction on a message', () => {
    expect(on([msg(1), reaction(2, '👍', { id: 1 }), reaction(3, '🙏', { id: 1 }, { direction: 'outbound' })], 1)).toEqual([
      { emoji: '👍', byBusiness: false },
      { emoji: '🙏', byBusiness: true },
    ])
  })

  it('reactions to different unknown messages stay separate; a lone removal shows nothing', () => {
    expect(kinds([reaction(2, '👍', { ref: 'x' }), reaction(3, '👍', { ref: 'y' })])).toEqual(['r:👍', 'r:👍'])
    expect(kinds([reaction(2, null, {})])).toEqual([])
  })

  it('a reaction row never becomes a bubble or the unsupported notice', () => {
    const list = [reaction(1, '👍', { id: 99 }), reaction(2, null, {}), reaction(3, '❤️', {})]
    for (const e of buildThreadEntries(list)) expect(e.kind).toBe('reaction')
    expect(JSON.stringify(buildThreadEntries(list))).not.toContain(UNSUPPORTED_MESSAGE_NOTICE)
  })
})

describe('replies', () => {
  it('quote one line of the quoted message, or say it is an earlier message', () => {
    const entries = buildThreadEntries([msg(1, { text: 'כמה עולה?\nתודה' }), msg(2, { replyTo: { targetId: 1 } }), msg(3, { replyTo: { targetId: null } })])
    const quotes = entries.map((e) => (e.kind === 'message' ? e.quote : 'x'))
    expect(quotes).toEqual([null, { preview: 'כמה עולה?' }, { preview: null }])
  })

  it('a media message is quoted by its caption, its file name, or its kind', () => {
    expect(quotePreview(msg(1, { type: 'image', text: '', caption: 'מחירון', attachment: { filename: null, mimeType: 'image/jpeg' } }))).toBe('מחירון')
    expect(quotePreview(msg(1, { type: 'document', text: '', attachment: { filename: 'הצעה.pdf', mimeType: 'application/pdf' } }))).toBe('הצעה.pdf')
    expect(quotePreview(msg(1, { type: 'audio', text: '', attachment: { filename: null, mimeType: 'audio/ogg' } }))).toBe('הודעה קולית')
    expect(quotePreview(msg(1, { text: 'א'.repeat(100) }))).toHaveLength(81)
  })
})

describe('bubble text and layout', () => {
  it('text, else caption, else nothing for a file, else the unsupported notice; null for empty text', () => {
    expect(messageBody(msg(1))).toBe('הודעה 1')
    expect(messageBody(msg(1, { type: 'image', text: '', caption: 'מחירון', attachment: { filename: null, mimeType: 'image/jpeg' } }))).toBe('מחירון')
    expect(messageBody(msg(1, { type: 'image', text: '', attachment: { filename: null, mimeType: 'image/jpeg' } }))).toBe('')
    expect(messageBody(msg(1, { type: 'location', text: '' }))).toBe(UNSUPPORTED_MESSAGE_NOTICE)
    expect(messageBody(msg(1, { text: '' }))).toBeNull()
  })

  it('a captioned photo keeps its padding and time row; a bare photo fills the bubble', () => {
    const photo = { type: 'image' as const, text: '', attachment: { filename: null, mimeType: 'image/jpeg' } }
    expect(bubbleMediaLayout(msg(1, photo))).toEqual({ photoBubble: true, mediaCarriesTime: true })
    expect(bubbleMediaLayout(msg(1, { ...photo, caption: 'מחירון' }))).toEqual({ photoBubble: false, mediaCarriesTime: false })
  })
})
