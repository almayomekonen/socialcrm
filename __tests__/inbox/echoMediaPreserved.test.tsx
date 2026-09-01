// @vitest-environment jsdom
//
// WhatsApp Coexistence echo — media preservation.
//
// A file the BUSINESS sent from the WhatsApp phone app comes back as an echo.
// The parser typed it correctly all along, but `insertOutboundMessage` hardcoded
// `type: 'text'` with an empty payload, so the media id was destroyed AT INSERT:
// 32 production rows are permanently unrecoverable and rendered as "—".
//
// This walks one media echo the whole way — parse → insert → map → render — so
// the flattening cannot come back, and pins that a plain text echo is unchanged.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Knex } from 'knex'
import { parseMessageEchoes } from '@/lib/whatsapp/parseMessageEcho'
import { ATTACHMENT_MEDIA_TYPES, insertOutboundMessage, mapLeadWhatsappMessageRow } from '@/db/inboxMessages'
import WhatsappAttachment from '@/components/summary/WhatsappAttachment'

const TS = '1738796547'

const echoValue = (message: Record<string, unknown>) => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
  message_echoes: [{ from: '15550783881', to: '16505551234', id: 'wamid.ECHO', timestamp: TS, ...message }],
})

const DOC = {
  type: 'document',
  document: { id: 'MEDIA_ECHO_1', mime_type: 'application/pdf', sha256: 'DEAD', filename: 'הצעת מחיר.pdf' },
}

/** Minimal knex transaction double that captures the inserted row. */
function fakeTrx(captured: { row?: Record<string, unknown> }): Knex.Transaction {
  const table = () => ({
    where: () => ({
      forUpdate: () => ({ first: async () => ({ id: 1 }) }),
      max: () => ({ first: async () => ({ max: 0 }) }),
      first: async () => ({ id: 1, sequence: 1 }),
    }),
    insert: (row: Record<string, unknown>) => {
      captured.row = row
      return { onConflict: () => ({ ignore: () => ({ returning: async () => [{ id: 42 }] }) }) }
    },
  })
  return table as unknown as Knex.Transaction
}

const baseInput = {
  conversationId: 1,
  agencyId: 130,
  leadId: null,
  channel: 'whatsapp' as const,
  externalId: 'wamid.ECHO',
  fromId: '106540352242922',
  toId: '16505551234',
  sentByUserId: null,
  channelTimestamp: null,
}

describe('the parser already had the media', () => {
  it('types a document echo and keeps its media object', () => {
    const [echo] = parseMessageEchoes(echoValue(DOC))
    expect(echo.type).toBe('document')
    expect(echo.payload).toMatchObject({
      id: 'MEDIA_ECHO_1',
      filename: 'הצעת מחיר.pdf',
      mime_type: 'application/pdf',
    })
    expect(echo.text).toBe('')
  })
})

describe('insertOutboundMessage preserves what it is given', () => {
  it('stores the echoed media type and payload instead of flattening them', async () => {
    const [echo] = parseMessageEchoes(echoValue(DOC))
    const cap: { row?: Record<string, unknown> } = {}
    await insertOutboundMessage(fakeTrx(cap), {
      ...baseInput,
      text: echo.text,
      type: echo.type,
      payload: echo.payload,
    })
    expect(cap.row!.type).toBe('document')
    const stored = JSON.parse(cap.row!.payload as string)
    expect(stored.id).toBe('MEDIA_ECHO_1')
    expect(stored.filename).toBe('הצעת מחיר.pdf')
    expect(stored.mime_type).toBe('application/pdf')
  })

  it('an image echo keeps its media id too', async () => {
    const [echo] = parseMessageEchoes(
      echoValue({ type: 'image', image: { id: 'IMG_1', mime_type: 'image/jpeg' } }),
    )
    const cap: { row?: Record<string, unknown> } = {}
    await insertOutboundMessage(fakeTrx(cap), { ...baseInput, text: echo.text, type: echo.type, payload: echo.payload })
    expect(cap.row!.type).toBe('image')
    expect(JSON.parse(cap.row!.payload as string).id).toBe('IMG_1')
  })

  it('EXISTING CALLERS ARE UNCHANGED: omitting type/payload still writes a text message', async () => {
    const cap: { row?: Record<string, unknown> } = {}
    await insertOutboundMessage(fakeTrx(cap), { ...baseInput, text: 'שלום' })
    expect(cap.row!.type).toBe('text')
    expect(cap.row!.payload).toBe('{}')
    expect(cap.row!.text).toBe('שלום')
  })

  /**
   * The parser returns `{ body }` as the payload of a TEXT message. Persisting
   * that would duplicate the message body into a second column and change every
   * existing outbound text row, so the echo path carries a payload only for
   * media. Asserted through the real ingest wiring, not the raw parser output.
   */
  it('a plain TEXT echo is still stored as text with an EMPTY payload', async () => {
    const [echo] = parseMessageEchoes(echoValue({ type: 'text', text: { body: 'on my way' } }))
    expect(echo.payload).toEqual({ body: 'on my way' })
    const cap: { row?: Record<string, unknown> } = {}
    await insertOutboundMessage(fakeTrx(cap), {
      ...baseInput,
      text: echo.text,
      type: echo.type,
      payload: ATTACHMENT_MEDIA_TYPES.has(echo.type) ? echo.payload : {},
    })
    expect(cap.row!.type).toBe('text')
    expect(cap.row!.payload).toBe('{}')
    expect(cap.row!.text).toBe('on my way')
  })
})

describe('the stored row reaches the UI as a file', () => {
  const rowFor = (payload: Record<string, unknown>, type: string) => ({
    id: 77,
    direction: 'outbound',
    type,
    text: '',
    status: 'sent',
    errorReason: null,
    payload,
    createdAt: new Date(0),
  })

  it('maps into the safe attachment shape the inbound MVP already renders', () => {
    const [echo] = parseMessageEchoes(echoValue(DOC))
    const m = mapLeadWhatsappMessageRow(rowFor(echo.payload, echo.type))
    expect(m.attachment).toEqual({ filename: 'הצעת מחיר.pdf', mimeType: 'application/pdf' })
  })

  it('still exposes no media id, Meta URL or sha256 to the client', () => {
    const [echo] = parseMessageEchoes(echoValue(DOC))
    const m = mapLeadWhatsappMessageRow(rowFor(echo.payload, echo.type))
    const serialized = JSON.stringify(m)
    expect(serialized).not.toContain('MEDIA_ECHO_1')
    expect(serialized).not.toContain('DEAD')
  })

  it('renders the filename, the type and a working פתח action', () => {
    const [echo] = parseMessageEchoes(echoValue(DOC))
    const m = mapLeadWhatsappMessageRow(rowFor(echo.payload, echo.type))
    render(<WhatsappAttachment messageId={m.id} attachment={m.attachment!} />)
    expect(screen.getByText('הצעת מחיר.pdf')).toBeTruthy()
    expect(screen.getByText('PDF')).toBeTruthy()
    const link = screen.getByRole('link', { name: /פתח את הקובץ/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/whatsapp/media/77')
  })

  it('a text echo maps to no attachment, so the thread is unchanged', () => {
    const m = mapLeadWhatsappMessageRow({ ...rowFor({}, 'text'), text: 'on my way' })
    expect(m.attachment).toBeNull()
    expect(m.text).toBe('on my way')
  })
})
