/**
 * Quick replies, button/generic templates, and the exact JSON that reaches Meta.
 *
 * Pure, so the wire shape is pinned without a network call. The limits asserted
 * here are Meta's, checked 2026-09-23 against the Send API docs.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BUTTON_TEMPLATE_TEXT_MAX,
  BUTTON_TITLE_MAX,
  buildMessengerMessage,
  BUTTONS_MAX,
  describeRichContent,
  GENERIC_MAX_ELEMENTS,
  GENERIC_TITLE_MAX,
  isSendableUrl,
  isStructured,
  QUICK_REPLY_MAX,
  QUICK_REPLY_TITLE_MAX,
  validateRichContent,
  type MessengerRichContent,
} from '@/lib/facebook/messenger/structured'
import { sendMessengerMessage } from '@/lib/facebook/messenger/send'

describe('quick replies', () => {
  it('ride alongside text, with content_type text and a payload', () => {
    const message = buildMessengerMessage('איך אפשר לעזור?', {
      quickReplies: [{ title: 'הצעת מחיר', payload: 'QUOTE' }],
    })
    expect(message).toEqual({
      text: 'איך אפשר לעזור?',
      quick_replies: [{ content_type: 'text', title: 'הצעת מחיר', payload: 'QUOTE' }],
    })
  })

  it('default the payload to the title — Meta requires one for a text quick reply', () => {
    const message = buildMessengerMessage('?', { quickReplies: [{ title: 'כן', payload: '' }] })
    expect((message!.quick_replies as { payload: string }[])[0].payload).toBe('כן')
  })

  it('are capped at Meta\'s maximum and title length', () => {
    const many = Array.from({ length: QUICK_REPLY_MAX + 5 }, (_, i) => ({ title: `א${i}`, payload: `P${i}` }))
    const message = buildMessengerMessage('x', { quickReplies: many })
    expect(message!.quick_replies as unknown[]).toHaveLength(QUICK_REPLY_MAX)

    const long = buildMessengerMessage('x', { quickReplies: [{ title: 'א'.repeat(50), payload: 'P' }] })
    expect((long!.quick_replies as { title: string }[])[0].title).toHaveLength(QUICK_REPLY_TITLE_MAX)
  })

  it('a quick reply with no text is dropped rather than sent blank', () => {
    const message = buildMessengerMessage('x', { quickReplies: [{ title: '  ', payload: 'P' }] })
    expect(message).not.toHaveProperty('quick_replies')
  })

  it('too many, or too long, is refused with a message naming the limit', () => {
    const many = Array.from({ length: QUICK_REPLY_MAX + 1 }, () => ({ title: 'א', payload: 'P' }))
    expect(validateRichContent({ quickReplies: many })).toEqual({ error: `אפשר עד ${QUICK_REPLY_MAX} תשובות מהירות` })
    expect(validateRichContent({ quickReplies: [{ title: 'א'.repeat(21), payload: 'P' }] })).toMatchObject({
      error: expect.stringContaining(String(QUICK_REPLY_TITLE_MAX)),
    })
  })
})

describe('button template', () => {
  it('wraps the text in a button-template attachment', () => {
    const message = buildMessengerMessage('רוצה לראות את המחירון?', {
      buttons: [{ type: 'web_url', title: 'למחירון', url: 'https://example.com/p' }],
    })
    expect(message).toEqual({
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: 'רוצה לראות את המחירון?',
          buttons: [{ type: 'web_url', title: 'למחירון', url: 'https://example.com/p' }],
        },
      },
    })
  })

  it('a postback button carries its payload, defaulting is handled upstream', () => {
    const message = buildMessengerMessage('בחר', { buttons: [{ type: 'postback', title: 'כן', payload: 'YES' }] })
    const buttons = (message!.attachment as { payload: { buttons: unknown[] } }).payload.buttons
    expect(buttons).toEqual([{ type: 'postback', title: 'כן', payload: 'YES' }])
  })

  it('without text there is nothing to attach buttons to — refused, not sent empty', () => {
    expect(buildMessengerMessage('', { buttons: [{ type: 'web_url', title: 'א', url: 'https://a.com' }] })).toBeNull()
  })

  it('caps text and button count at Meta\'s limits', () => {
    const message = buildMessengerMessage('א'.repeat(BUTTON_TEMPLATE_TEXT_MAX + 100), {
      buttons: Array.from({ length: BUTTONS_MAX + 2 }, (_, i) => ({
        type: 'web_url' as const,
        title: `ב${i}`,
        url: 'https://a.com',
      })),
    })
    const payload = (message!.attachment as { payload: { text: string; buttons: unknown[] } }).payload
    expect(payload.text).toHaveLength(BUTTON_TEMPLATE_TEXT_MAX)
    expect(payload.buttons).toHaveLength(BUTTONS_MAX)
  })

  it('refuses a link button whose URL is not https and publicly resolvable', () => {
    expect(validateRichContent({ buttons: [{ type: 'web_url', title: 'א', url: 'http://a.com' }] })).toMatchObject({
      error: expect.stringContaining('https'),
    })
    expect(validateRichContent({ buttons: [{ type: 'web_url', title: 'א', url: 'https://localhost' }] })).toMatchObject({
      error: expect.stringContaining('https'),
    })
    expect(validateRichContent({ buttons: [{ type: 'web_url', title: 'א', url: 'https://a.com' }] })).toEqual({ ok: true })
  })

  it('refuses a button with no text', () => {
    expect(validateRichContent({ buttons: [{ type: 'web_url', title: '', url: 'https://a.com' }] })).toMatchObject({
      error: 'לכל כפתור צריך טקסט',
    })
  })
})

describe('generic template', () => {
  it('builds a carousel of elements', () => {
    const message = buildMessengerMessage('', {
      elements: [
        {
          title: 'חבילה בסיסית',
          subtitle: '₪99 לחודש',
          imageUrl: 'https://cdn.example/a.jpg',
          buttons: [{ type: 'web_url', title: 'פרטים', url: 'https://example.com/a' }],
        },
      ],
    })
    expect(message).toEqual({
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [
            {
              title: 'חבילה בסיסית',
              subtitle: '₪99 לחודש',
              image_url: 'https://cdn.example/a.jpg',
              buttons: [{ type: 'web_url', title: 'פרטים', url: 'https://example.com/a' }],
            },
          ],
        },
      },
    })
  })

  it('omits optional element fields rather than sending empty strings', () => {
    const message = buildMessengerMessage('', { elements: [{ title: 'רק כותרת' }] })
    const element = (message!.attachment as { payload: { elements: Record<string, unknown>[] } }).payload.elements[0]
    expect(element).toEqual({ title: 'רק כותרת' })
  })

  it('caps elements and their titles', () => {
    const many = Array.from({ length: GENERIC_MAX_ELEMENTS + 3 }, (_, i) => ({ title: `כרטיס ${i}` }))
    const message = buildMessengerMessage('', { elements: many })
    expect((message!.attachment as { payload: { elements: unknown[] } }).payload.elements).toHaveLength(
      GENERIC_MAX_ELEMENTS,
    )
    expect(validateRichContent({ elements: [{ title: 'א'.repeat(GENERIC_TITLE_MAX + 1) }] })).toMatchObject({
      error: expect.stringContaining(String(GENERIC_TITLE_MAX)),
    })
  })

  it('refuses a card with no title', () => {
    expect(validateRichContent({ elements: [{ title: '  ' }] })).toEqual({ error: 'לכל כרטיס צריך כותרת' })
  })
})

describe('combinations Meta cannot express', () => {
  it('buttons AND cards is refused — one message takes one attachment', () => {
    const content: MessengerRichContent = {
      buttons: [{ type: 'web_url', title: 'א', url: 'https://a.com' }],
      elements: [{ title: 'כרטיס' }],
    }
    expect(validateRichContent(content)).toMatchObject({ error: expect.stringContaining('לא את שניהם') })
  })

  it('an attachment AND a template is refused for the same reason', () => {
    expect(
      validateRichContent({
        attachment: { type: 'image', url: 'https://a.com/x.jpg' },
        buttons: [{ type: 'web_url', title: 'א', url: 'https://a.com' }],
      }),
    ).toMatchObject({ error: expect.stringContaining('לא את שניהם') })
  })

  it('an attachment goes by URL, never as a reusable id that would expire', () => {
    const message = buildMessengerMessage('', { attachment: { type: 'image', url: 'https://a.com/x.jpg' } })
    expect(message).toEqual({
      attachment: { type: 'image', payload: { url: 'https://a.com/x.jpg', is_reusable: false } },
    })
  })

  it('nothing to send returns null instead of an empty message', () => {
    expect(buildMessengerMessage('', {})).toBeNull()
    expect(buildMessengerMessage('   ', {})).toBeNull()
  })
})

describe('helpers', () => {
  it('isSendableUrl demands https and a resolvable host', () => {
    expect(isSendableUrl('https://example.com/a.pdf')).toBe(true)
    expect(isSendableUrl('http://example.com')).toBe(false)
    expect(isSendableUrl('https://localhost:3000')).toBe(false)
    expect(isSendableUrl('not a url')).toBe(false)
    expect(isSendableUrl(null)).toBe(false)
  })

  it('isStructured distinguishes a plain text reply', () => {
    expect(isStructured({})).toBe(false)
    expect(isStructured({ quickReplies: [{ title: 'א', payload: 'A' }] })).toBe(true)
  })

  it('the preview describes structure when there is no text, never an empty line', () => {
    expect(describeRichContent('שלום', {})).toBe('שלום')
    expect(describeRichContent('', { elements: [{ title: 'א' }] })).toBe('[כרטיסים]')
    expect(describeRichContent('', { attachment: { type: 'file', url: 'https://a.com/x' } })).toBe('[קובץ מצורף]')
  })
})

describe('what reaches Meta on the wire', () => {
  it('sends messaging_type RESPONSE with the built message and never a tag', async () => {
    const calls: { body: Record<string, unknown> }[] = []
    const impl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ body: JSON.parse(String(init.body)) })
      return { ok: true, status: 200, json: async () => ({ message_id: 'mid.1' }) } as unknown as Response
    }) as unknown as typeof fetch

    const result = await sendMessengerMessage({
      pageId: 'P1',
      pageAccessToken: 'T',
      psid: 'PSID1',
      text: 'בחר',
      content: { quickReplies: [{ title: 'כן', payload: 'YES' }] },
      fetchImpl: impl,
    })

    expect(result).toEqual({ ok: true, mid: 'mid.1' })
    expect(calls[0].body).toEqual({
      recipient: { id: 'PSID1' },
      messaging_type: 'RESPONSE',
      message: { text: 'בחר', quick_replies: [{ content_type: 'text', title: 'כן', payload: 'YES' }] },
    })
    expect(calls[0].body).not.toHaveProperty('tag')
  })

  it('an unsendable message is refused locally, without calling Meta', async () => {
    const impl = vi.fn() as unknown as typeof fetch
    const result = await sendMessengerMessage({
      pageId: 'P1',
      pageAccessToken: 'T',
      psid: 'PSID1',
      text: '',
      content: {},
      fetchImpl: impl,
    })
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid_response' } })
    expect(impl).not.toHaveBeenCalled()
  })
})
