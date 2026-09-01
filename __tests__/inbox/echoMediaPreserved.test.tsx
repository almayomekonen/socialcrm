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
import { render, screen, fireEvent } from '@testing-library/react'
import type { Knex } from 'knex'
import { parseMessageEchoes } from '@/lib/whatsapp/parseMessageEcho'
import { ATTACHMENT_MEDIA_TYPES, insertOutboundMessage, mapLeadWhatsappMessageRow } from '@/db/inboxMessages'
import WhatsappAttachment from '@/components/summary/WhatsappAttachment'
import { UNNAMED_ATTACHMENT_LABEL, UNNAMED_AUDIO_LABEL } from '@/lib/inbox/attachmentDisplay'

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

/**
 * Media UX — an image is a picture, a PDF is a document.
 *
 * Rendering a received photo as a generic "קובץ וואטסאפ / תמונה / פתח" card was
 * technically correct and mentally wrong: the rep had to click to find out what
 * they had been sent. The branch is keyed on the mime already in the safe client
 * shape, so telling a photo from a document costs no extra data exposure.
 */
describe('media UX — image renders as an image, documents keep the card', () => {
  const img = (mimeType: string | null, filename: string | null = 'photo.jpg') => ({ filename, mimeType })

  it('renders an actual image preview, not the document card', () => {
    render(<WhatsappAttachment messageId={5} attachment={img('image/jpeg')} />)
    const el = screen.getByAltText('photo.jpg') as HTMLImageElement
    expect(el.tagName).toBe('IMG')
    expect(screen.queryByText('פתח')).toBeNull()
  })

  it('the preview loads through the existing authenticated media route', () => {
    render(<WhatsappAttachment messageId={5} attachment={img('image/png')} />)
    const el = screen.getByAltText('photo.jpg') as HTMLImageElement
    expect(el.getAttribute('src')).toBe('/api/whatsapp/media/5')
  })

  it('preserves aspect ratio and is bounded so it cannot take over the thread', () => {
    render(<WhatsappAttachment messageId={5} attachment={img('image/jpeg')} />)
    const cls = screen.getByAltText('photo.jpg').getAttribute('class') ?? ''
    expect(cls).toContain('object-contain')
    expect(cls).toContain('max-w-full')
    expect(cls).toContain('max-h-')
    expect(cls).toContain('h-auto')
  })

  it('defers offscreen images so a long conversation stays cheap', () => {
    render(<WhatsappAttachment messageId={5} attachment={img('image/jpeg')} />)
    const el = screen.getByAltText('photo.jpg')
    expect(el.getAttribute('loading')).toBe('lazy')
    expect(el.getAttribute('decoding')).toBe('async')
  })

  it('names an unnamed image for screen readers rather than leaving alt empty', () => {
    render(<WhatsappAttachment messageId={5} attachment={img('image/jpeg', null)} />)
    expect(screen.getByAltText('תמונה שהתקבלה בוואטסאפ')).toBeTruthy()
  })

  it('falls back to the file card when the image cannot load', () => {
    render(<WhatsappAttachment messageId={5} attachment={img('image/jpeg')} />)
    fireEvent.error(screen.getByAltText('photo.jpg'))
    expect(screen.queryByAltText('photo.jpg')).toBeNull()
    expect(screen.getByText('photo.jpg')).toBeTruthy()
    expect(screen.getByRole('link', { name: /פתח את הקובץ/ })).toBeTruthy()
  })

  it('a PDF still renders the document card, never an image', () => {
    render(<WhatsappAttachment messageId={9} attachment={{ filename: 'בס״ד (4).pdf', mimeType: 'application/pdf' }} />)
    expect(screen.getByText('בס״ד (4).pdf')).toBeTruthy()
    expect(screen.getByText('PDF')).toBeTruthy()
    expect(screen.getByRole('link', { name: /פתח את הקובץ/ })).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('a generic document still renders the document card', () => {
    render(<WhatsappAttachment messageId={9} attachment={{ filename: 'sheet.xlsx', mimeType: 'application/vnd.ms-excel' }} />)
    expect(screen.getByText('sheet.xlsx')).toBeTruthy()
    expect(screen.getByText('Excel')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('an attachment with no mime type stays a document card', () => {
    render(<WhatsappAttachment messageId={9} attachment={{ filename: null, mimeType: null }} />)
    expect(screen.getByText(UNNAMED_ATTACHMENT_LABEL)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('an image echo end-to-end still exposes no media id or sha256 to the client', () => {
    const [echo] = parseMessageEchoes(
      echoValue({ type: 'image', image: { id: 'IMG_SECRET', sha256: 'HASH', mime_type: 'image/jpeg' } }),
    )
    const m = mapLeadWhatsappMessageRow({
      id: 12,
      direction: 'outbound',
      type: echo.type,
      text: '',
      status: 'sent',
      errorReason: null,
      payload: echo.payload,
      createdAt: new Date(0),
    })
    expect(JSON.stringify(m)).not.toContain('IMG_SECRET')
    expect(JSON.stringify(m)).not.toContain('HASH')
    render(<WhatsappAttachment messageId={m.id} attachment={m.attachment!} />)
    const el = screen.getByRole('img') as HTMLImageElement
    expect(el.getAttribute('src')).toBe('/api/whatsapp/media/12')
  })
})

/**
 * Audio UX — a voice note is played, not downloaded.
 *
 * Production has 241 audio messages and every one is `audio/ogg; codecs=opus`
 * with `voice: true` and NO filename, so the file card showed a rep an anonymous
 * "קובץ מוואטסאפ / הקלטה / פתח" for what is simply someone talking. The primary
 * action has to be PLAY.
 */
describe('media UX — audio renders a player', () => {
  const audio = (mimeType: string | null = 'audio/ogg', filename: string | null = null) => ({ filename, mimeType })
  const playerOf = (c: HTMLElement) => c.querySelector('audio') as HTMLAudioElement | null

  it('renders an audio player, not the file card', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    const el = playerOf(container)!
    expect(el).toBeTruthy()
    expect(el.hasAttribute('controls')).toBe(true)
    expect(screen.queryByText('פתח')).toBeNull()
  })

  it('plays through the existing authenticated media route', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(playerOf(container)!.getAttribute('src')).toBe('/api/whatsapp/media/7')
  })

  it('the real production mime (ogg/opus, params already stripped) is treated as audio', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio('audio/ogg')} />)
    expect(playerOf(container)).toBeTruthy()
  })

  it('names an unnamed voice note in Hebrew instead of leaving it anonymous', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(screen.getByText(UNNAMED_AUDIO_LABEL)).toBeTruthy()
    expect(playerOf(container)!.getAttribute('aria-label')).toBe(`נגן הקלטה: ${UNNAMED_AUDIO_LABEL}`)
  })

  it('prefers a real filename when WhatsApp supplies one', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio('audio/mpeg', 'jingle.mp3')} />)
    expect(screen.getByText('jingle.mp3')).toBeTruthy()
    expect(playerOf(container)!.getAttribute('aria-label')).toBe('נגן הקלטה: jingle.mp3')
  })

  it('does not download the whole recording just to show the thread', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(playerOf(container)!.getAttribute('preload')).toBe('metadata')
  })

  it('is bounded so it cannot overflow the bubble', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    const cls = playerOf(container)!.getAttribute('class') ?? ''
    expect(cls).toContain('max-w-full')
    expect(cls).toContain('focus-visible:ring-2')
  })

  it('falls back to the file card when the audio cannot play', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    fireEvent.error(playerOf(container)!)
    expect(playerOf(container)).toBeNull()
    expect(screen.getByRole('link', { name: /פתח את הקובץ/ })).toBeTruthy()
  })

  it('an audio echo end-to-end exposes no media id, sha256 or Meta URL', () => {
    const [echo] = parseMessageEchoes(
      echoValue({
        type: 'audio',
        audio: { id: 'AUD_SECRET', sha256: 'AUDHASH', url: 'https://lookaside.fbsbx.com/SECRET', mime_type: 'audio/ogg; codecs=opus', voice: true },
      }),
    )
    const m = mapLeadWhatsappMessageRow({
      id: 21, direction: 'inbound', type: echo.type, text: '', status: 'received',
      errorReason: null, payload: echo.payload, createdAt: new Date(0),
    })
    const serialized = JSON.stringify(m)
    expect(serialized).not.toContain('AUD_SECRET')
    expect(serialized).not.toContain('AUDHASH')
    expect(serialized).not.toContain('lookaside.fbsbx.com')
    // The `voice` flag stays server-side too: the safe shape is filename + mime.
    expect(Object.keys(m.attachment!).sort()).toEqual(['filename', 'mimeType'])
    expect(m.attachment!.mimeType).toBe('audio/ogg')

    const { container } = render(<WhatsappAttachment messageId={m.id} attachment={m.attachment!} />)
    expect((container.querySelector('audio') as HTMLAudioElement).getAttribute('src')).toBe('/api/whatsapp/media/21')
  })

  it('leaves the image and document branches untouched', () => {
    const a = render(<WhatsappAttachment messageId={1} attachment={{ filename: 'p.jpg', mimeType: 'image/jpeg' }} />)
    expect(a.container.querySelector('img')).toBeTruthy()
    expect(a.container.querySelector('audio')).toBeNull()

    const b = render(<WhatsappAttachment messageId={2} attachment={{ filename: 'x.pdf', mimeType: 'application/pdf' }} />)
    expect(b.container.querySelector('audio')).toBeNull()
    expect(b.container.querySelector('img')).toBeNull()

    const c = render(<WhatsappAttachment messageId={3} attachment={{ filename: null, mimeType: null }} />)
    expect(c.container.querySelector('audio')).toBeNull()
    expect(screen.getAllByText(UNNAMED_ATTACHMENT_LABEL).length).toBeGreaterThan(0)
  })
})
