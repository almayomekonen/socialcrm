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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Knex } from 'knex'
import { parseMessageEchoes } from '@/lib/whatsapp/parseMessageEcho'
import { ATTACHMENT_MEDIA_TYPES, insertOutboundMessage, mapLeadWhatsappMessageRow } from '@/db/inboxMessages'
import WhatsappAttachment from '@/components/summary/WhatsappAttachment'
import { resetVoiceNoteRegistry } from '@/lib/inbox/voiceNotePlayback'
import { UNNAMED_ATTACHMENT_LABEL } from '@/lib/inbox/attachmentDisplay'

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

  it('renders a voice-note control, not the file card', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(playerOf(container)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'נגן הקלטה' })).toBeTruthy()
    expect(screen.queryByText('פתח')).toBeNull()
  })

  it('hides the raw browser player chrome — the row is the conversation UI', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(playerOf(container)!.hasAttribute('controls')).toBe(false)
  })

  it('shows play, a seekable position and a duration readout', () => {
    render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(screen.getByRole('button', { name: 'נגן הקלטה' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'מיקום בהקלטה' })).toBeTruthy()
    expect(screen.getByText(/0:00 \/ 0:00/)).toBeTruthy()
  })

  it('plays through the existing authenticated media route', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(playerOf(container)!.getAttribute('src')).toBe('/api/whatsapp/media/7')
  })

  it('the real production mime (ogg/opus, params already stripped) is treated as audio', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio('audio/ogg')} />)
    expect(playerOf(container)).toBeTruthy()
  })

  it('drops the explanatory label — a voice note announces itself by its control', () => {
    render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(screen.queryByText('הקלטה מוואטסאפ')).toBeNull()
    // The Hebrew name lives on the control, so nothing is lost for screen readers.
    expect(screen.getByRole('button', { name: 'נגן הקלטה' })).toBeTruthy()
  })

  it('renders the message timestamp beside the control, never a second one', () => {
    render(<WhatsappAttachment messageId={7} attachment={audio()} timestampLabel='16:27' />)
    expect(screen.getAllByText('16:27')).toHaveLength(1)
  })

  it('does not download the whole recording just to show the thread', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    expect(playerOf(container)!.getAttribute('preload')).toBe('metadata')
  })

  it('is compact and bounded so it cannot overflow the bubble', () => {
    const { container } = render(<WhatsappAttachment messageId={7} attachment={audio()} />)
    const row = container.querySelector('div.flex.items-center') as HTMLElement
    const cls = row.getAttribute('class') ?? ''
    expect(cls).toContain('max-w-full')
    expect(cls).toMatch(/w-\[\d+px\]/)
    expect(screen.getByRole('button', { name: 'נגן הקלטה' }).getAttribute('class')).toContain('focus-visible:ring-2')
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

/**
 * Image viewer — clicking a photo VIEWS it.
 *
 * It used to be an <a href> at the media route, and the route says
 * `Content-Disposition: attachment`, so a click downloaded the photo instead of
 * showing it. The fix is not a route change: an <img> never navigates, so
 * rendering the picture in a dialog sidesteps the disposition entirely while the
 * route, its headers and its auth stay exactly as they were.
 */
describe('image viewer', () => {
  const photo = { filename: 'wedding.jpg', mimeType: 'image/jpeg' }
  const openViewer = () => {
    render(<WhatsappAttachment messageId={4} attachment={photo} />)
    const trigger = screen.getByRole('button', { name: /הצג את התמונה/ })
    // A real click focuses the button; jsdom's fireEvent does not, and the
    // dialog restores focus to whatever was focused when it opened.
    trigger.focus()
    fireEvent.click(trigger)
    return trigger
  }

  it('the thumbnail is a button, not a download link', () => {
    render(<WhatsappAttachment messageId={4} attachment={photo} />)
    expect(screen.getByRole('button', { name: /הצג את התמונה/ })).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('advertises that it opens a dialog', () => {
    render(<WhatsappAttachment messageId={4} attachment={photo} />)
    expect(screen.getByRole('button', { name: /הצג את התמונה/ }).getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('opens a dialog with an accessible name', () => {
    openViewer()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-label') ?? '').toContain('תמונה')
  })

  it('shows the picture from the SAME authenticated route, full size', () => {
    openViewer()
    const shown = screen.getByRole('dialog').querySelector('img') as HTMLImageElement
    expect(shown.getAttribute('src')).toBe('/api/whatsapp/media/4')
    expect(shown.getAttribute('class') ?? '').toContain('object-contain')
  })

  it('the picture keeps a meaningful alt inside the viewer', () => {
    openViewer()
    expect((screen.getByRole('dialog').querySelector('img') as HTMLImageElement).getAttribute('alt')).toBe('wedding.jpg')
  })

  it('has a labelled close control', () => {
    openViewer()
    expect(screen.getByRole('button', { name: 'סגירה' })).toBeTruthy()
  })

  it('closes on the close control and returns focus to the photo', () => {
    const trigger = openViewer()
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('Escape closes it', () => {
    openViewer()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never leaks a Meta URL or media id into the viewer', () => {
    openViewer()
    const html = screen.getByRole('dialog').innerHTML
    expect(html).not.toContain('lookaside')
    expect(html).toContain('/api/whatsapp/media/4')
  })
})

describe('image is the bubble — timestamp overlays the photo', () => {
  const photo = { filename: 'p.jpg', mimeType: 'image/jpeg' }

  it('renders the message time over the image exactly once', () => {
    render(<WhatsappAttachment messageId={4} attachment={photo} timestampLabel='12:43' />)
    expect(screen.getAllByText('12:43')).toHaveLength(1)
  })

  it('positions the time in a bottom corner, over the picture', () => {
    const { container } = render(<WhatsappAttachment messageId={4} attachment={photo} timestampLabel='12:43' />)
    const stamp = screen.getByText('12:43')
    const cls = stamp.getAttribute('class') ?? ''
    expect(cls).toContain('absolute')
    expect(cls).toContain('bottom-')
    // The wrapper is the positioning context, so the stamp sits on the image.
    expect((container.querySelector('button') as HTMLElement).getAttribute('class')).toContain('relative')
  })

  it('adds a readability gradient that does not swallow clicks or the picture', () => {
    const { container } = render(<WhatsappAttachment messageId={4} attachment={photo} timestampLabel='12:43' />)
    const grad = container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(grad.getAttribute('class')).toContain('pointer-events-none')
    expect(grad.getAttribute('class')).toContain('bg-gradient-to-t')
  })

  it('renders no explanatory file text around the photo', () => {
    render(<WhatsappAttachment messageId={4} attachment={photo} timestampLabel='12:43' />)
    expect(screen.queryByText('קובץ מוואטסאפ')).toBeNull()
    expect(screen.queryByText('תמונה')).toBeNull()
    expect(screen.queryByText('פתח')).toBeNull()
  })

  it('omits the overlay entirely when no timestamp is supplied', () => {
    const { container } = render(<WhatsappAttachment messageId={4} attachment={photo} />)
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})

/**
 * Voice-note playback mechanics.
 *
 * jsdom ships no HTMLMediaElement implementation — `duration` is NaN, `play()`
 * throws "not implemented" — so the element is stubbed and the real media events
 * are dispatched. That is the point: the UI must be driven by what the element
 * reports, so the test drives the element and asserts the UI follows.
 */
describe('voice note — element-driven playback', () => {
  // Module-level registry: without this, players from a previous case stay
  // registered and get paused by the next one.
  beforeEach(() => resetVoiceNoteRegistry())

  const audioAttachment = { filename: null, mimeType: 'audio/ogg' }

  type Stub = { el: HTMLAudioElement; setTime: (t: number) => void; setDuration: (d: number) => void; playSpy: ReturnType<typeof vi.fn>; pauseSpy: ReturnType<typeof vi.fn> }

  function stubAudio(el: HTMLAudioElement, opts: { duration?: number; seekableEnd?: number } = {}): Stub {
    let dur = opts.duration ?? NaN
    let cur = 0
    let paused = true
    const seekableEnd = opts.seekableEnd ?? 0
    Object.defineProperty(el, 'duration', { configurable: true, get: () => dur })
    Object.defineProperty(el, 'currentTime', { configurable: true, get: () => cur, set: (v: number) => { cur = v } })
    Object.defineProperty(el, 'paused', { configurable: true, get: () => paused })
    Object.defineProperty(el, 'seekable', {
      configurable: true,
      get: () => ({ length: seekableEnd > 0 ? 1 : 0, end: () => seekableEnd }),
    })
    const playSpy = vi.fn(async () => { paused = false; fireEvent(el, new Event('play')) })
    const pauseSpy = vi.fn(() => { paused = true; fireEvent(el, new Event('pause')) })
    el.play = playSpy as unknown as HTMLAudioElement['play']
    el.pause = pauseSpy as unknown as HTMLAudioElement['pause']
    return {
      el, playSpy, pauseSpy,
      setTime: (t: number) => { cur = t; fireEvent(el, new Event('timeupdate')) },
      setDuration: (d: number) => { dur = d; fireEvent(el, new Event('loadedmetadata')) },
    }
  }

  const slider = (c: HTMLElement) => c.querySelector('input[type=range]') as HTMLInputElement
  const audioEl = (c: HTMLElement) => c.querySelector('audio') as HTMLAudioElement

  it('renders two independent players in one conversation', () => {
    const { container } = render(
      <div>
        <WhatsappAttachment messageId={1} attachment={audioAttachment} />
        <WhatsappAttachment messageId={2} attachment={audioAttachment} />
      </div>,
    )
    const audios = container.querySelectorAll('audio')
    expect(audios).toHaveLength(2)
    expect(audios[0].getAttribute('src')).toBe('/api/whatsapp/media/1')
    expect(audios[1].getAttribute('src')).toBe('/api/whatsapp/media/2')
    expect(screen.getAllByRole('button', { name: 'נגן הקלטה' })).toHaveLength(2)
  })

  /**
   * REPLACES the earlier "playing B never pauses A" assertion. That pinned an
   * explicitly requested behaviour which the product then reversed to WhatsApp
   * semantics: at most one recording plays at a time. The old expectation is
   * inverted here rather than deleted, so the invariant stays covered.
   */
  it('starting B pauses A — at most one voice note plays', () => {
    const { container } = render(
      <div>
        <WhatsappAttachment messageId={1} attachment={audioAttachment} />
        <WhatsappAttachment messageId={2} attachment={audioAttachment} />
      </div>,
    )
    const [a, b] = [...container.querySelectorAll('audio')] as HTMLAudioElement[]
    const sa = stubAudio(a, { duration: 10 })
    const sb = stubAudio(b, { duration: 10 })

    fireEvent.click(screen.getAllByRole('button', { name: 'נגן הקלטה' })[0]) // A
    expect(sa.playSpy).toHaveBeenCalled()
    expect(sa.pauseSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'נגן הקלטה' })) // B (A now shows "השהה")
    expect(sb.playSpy).toHaveBeenCalled()
    expect(sa.pauseSpy).toHaveBeenCalled()
    // Exactly one player is in the playing state.
    expect(screen.getAllByRole('button', { name: 'השהה הקלטה' })).toHaveLength(1)
  })

  it('a player never pauses itself when it claims playback', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stubAudio(audioEl(container), { duration: 10 })
    fireEvent.click(screen.getByRole('button', { name: 'נגן הקלטה' }))
    expect(s.playSpy).toHaveBeenCalled()
    expect(s.pauseSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'השהה הקלטה' })).toBeTruthy()
  })

  it('the paused player keeps its own position for resume', () => {
    const { container } = render(
      <div>
        <WhatsappAttachment messageId={1} attachment={audioAttachment} />
        <WhatsappAttachment messageId={2} attachment={audioAttachment} />
      </div>,
    )
    const [a, b] = [...container.querySelectorAll('audio')] as HTMLAudioElement[]
    const sa = stubAudio(a, { duration: 30 })
    stubAudio(b, { duration: 30 })
    sa.setDuration(30)
    fireEvent.click(screen.getAllByRole('button', { name: 'נגן הקלטה' })[0])
    sa.setTime(11)
    fireEvent.click(screen.getByRole('button', { name: 'נגן הקלטה' })) // start B, pausing A
    const sliders = container.querySelectorAll('input[type=range]')
    expect(Number((sliders[0] as HTMLInputElement).value)).toBeCloseTo(11)
    expect(a.currentTime).toBeCloseTo(11)
  })

  it('each player keeps its own playing state and its own position', () => {
    const { container } = render(
      <div>
        <WhatsappAttachment messageId={1} attachment={audioAttachment} />
        <WhatsappAttachment messageId={2} attachment={audioAttachment} />
      </div>,
    )
    const [a, b] = [...container.querySelectorAll('audio')] as HTMLAudioElement[]
    const sa = stubAudio(a, { duration: 20 })
    stubAudio(b, { duration: 20 })
    sa.setDuration(20)
    fireEvent.click(screen.getAllByRole('button', { name: 'נגן הקלטה' })[0])
    sa.setTime(7)
    // A is playing and at 0:07; B is untouched.
    expect(screen.getAllByRole('button', { name: 'השהה הקלטה' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'נגן הקלטה' })).toHaveLength(1)
    const sliders = container.querySelectorAll('input[type=range]')
    expect(Number((sliders[0] as HTMLInputElement).value)).toBeCloseTo(7)
    expect(Number((sliders[1] as HTMLInputElement).value)).toBe(0)
  })

  it('loadedmetadata takes the duration from the element', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    stubAudio(audioEl(container), { duration: 12.5 }).setDuration(12.5)
    expect(screen.getByText('0:00 / 0:12')).toBeTruthy()
    expect(Number(slider(container).max)).toBeCloseTo(12.5)
    expect(slider(container).disabled).toBe(false)
  })

  it('timeupdate moves both the readout and the bar to the real position', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stubAudio(audioEl(container), { duration: 60 })
    s.setDuration(60)
    s.setTime(33)
    expect(screen.getByText('0:33 / 1:00')).toBeTruthy()
    expect(Number(slider(container).value)).toBeCloseTo(33)
  })

  it('seeking writes to audio.currentTime and the UI follows immediately', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stubAudio(audioEl(container), { duration: 40 })
    s.setDuration(40)
    fireEvent.change(slider(container), { target: { value: '25' } })
    expect(audioEl(container).currentTime).toBe(25)
    expect(Number(slider(container).value)).toBeCloseTo(25)
    expect(screen.getByText('0:25 / 0:40')).toBeTruthy()
  })

  it('pause freezes the bar at the real position', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stubAudio(audioEl(container), { duration: 30 })
    s.setDuration(30)
    fireEvent.click(screen.getByRole('button', { name: 'נגן הקלטה' }))
    s.setTime(9)
    fireEvent.click(screen.getByRole('button', { name: 'השהה הקלטה' }))
    expect(screen.getByRole('button', { name: 'נגן הקלטה' })).toBeTruthy()
    expect(Number(slider(container).value)).toBeCloseTo(9)
    expect(screen.getByText('0:09 / 0:30')).toBeTruthy()
  })

  it('ended returns to the play state with the bar at the end', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stubAudio(audioEl(container), { duration: 15 })
    s.setDuration(15)
    fireEvent.click(screen.getByRole('button', { name: 'נגן הקלטה' }))
    s.setTime(14.7)
    fireEvent(audioEl(container), new Event('ended'))
    expect(screen.getByRole('button', { name: 'נגן הקלטה' })).toBeTruthy()
    expect(Number(slider(container).value)).toBeCloseTo(15)
    expect(screen.getByText('0:15 / 0:15')).toBeTruthy()
  })

  it('never renders NaN or Infinity before metadata exists', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    stubAudio(audioEl(container), { duration: NaN })
    fireEvent(audioEl(container), new Event('loadedmetadata'))
    const v = slider(container)
    expect(v.disabled).toBe(true)
    expect(Number(v.value)).toBe(0)
    expect(container.textContent).not.toMatch(/NaN|Infinity/)
    expect(screen.getByText('0:00 / 0:00')).toBeTruthy()
  })

  it('recovers a usable length when the element reports Infinity', () => {
    // The media route sends no Range support, so browsers commonly report an
    // infinite duration until the whole file is buffered. The seekable end is
    // the fallback that keeps the bar alive instead of freezing it.
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stubAudio(audioEl(container), { duration: Infinity, seekableEnd: 8 })
    s.setDuration(Infinity)
    expect(slider(container).disabled).toBe(false)
    expect(Number(slider(container).max)).toBeCloseTo(8)
    expect(screen.getByText('0:00 / 0:08')).toBeTruthy()
    expect(container.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('an element error clears the playing state and falls back to the file card', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stubAudio(audioEl(container), { duration: 10 })
    s.setDuration(10)
    fireEvent.click(screen.getByRole('button', { name: 'נגן הקלטה' }))
    fireEvent(audioEl(container), new Event('error'))
    expect(container.querySelector('audio')).toBeNull()
    expect(screen.getByRole('link', { name: /פתח את הקובץ/ })).toBeTruthy()
  })

  it('gives the readout breathing room from the rail', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    // The slider now sits inside a positioned rail wrapper; the spacing lives on
    // the column that holds the rail and the numbers.
    const col = slider(container).parentElement!.parentElement as HTMLElement
    expect(col.getAttribute('class')).toContain('gap-2')
    expect(col.getAttribute('class')).not.toContain('gap-1')
  })

  it('keeps the row compact and the controls accessible', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const row = container.querySelector('div.flex.items-center') as HTMLElement
    expect(row.getAttribute('class')).toContain('w-[230px]')
    expect(screen.getByRole('slider', { name: 'מיקום בהקלטה' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'נגן הקלטה' }).getAttribute('class')).toContain('focus-visible:ring-2')
  })
})

/**
 * The visible progress element.
 *
 * The rail LOOKED frozen in production while `value` was updating perfectly: at
 * `h-1` Chrome derives a slider thumb as wide as the whole track (measured 190px
 * on a 190px track), so the control painted identically at 0%, 50% and 100%.
 * Progress is now an explicit element with a real width, and these tests assert
 * that width actually moves — the thing the earlier suite never checked.
 */
describe('voice note — visible progress fill', () => {
  beforeEach(() => resetVoiceNoteRegistry())
  const audioAttachment = { filename: null, mimeType: 'audio/ogg' }
  const fillOf = (c: HTMLElement) => c.querySelector('[data-testid=voice-progress-fill]') as HTMLElement
  const audioEl2 = (c: HTMLElement) => c.querySelector('audio') as HTMLAudioElement

  function stub(el: HTMLAudioElement, duration: number) {
    let cur = 0
    Object.defineProperty(el, 'duration', { configurable: true, get: () => duration })
    Object.defineProperty(el, 'currentTime', { configurable: true, get: () => cur, set: (v: number) => { cur = v } })
    Object.defineProperty(el, 'paused', { configurable: true, get: () => true })
    Object.defineProperty(el, 'seekable', { configurable: true, get: () => ({ length: 0, end: () => 0 }) })
    el.play = vi.fn(async () => {}) as unknown as HTMLAudioElement['play']
    el.pause = vi.fn() as unknown as HTMLAudioElement['pause']
    return {
      setTime: (t: number) => { cur = t; fireEvent(el, new Event('timeupdate')) },
      meta: () => fireEvent(el, new Event('loadedmetadata')),
    }
  }

  it('renders a dedicated progress element, not just a native thumb', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    expect(fillOf(container)).toBeTruthy()
  })

  it('the fill WIDTH tracks currentTime — 0%, 50%, 100%', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stub(audioEl2(container), 10)
    s.meta()
    expect(fillOf(container).style.width).toBe('0%')
    s.setTime(5)
    expect(fillOf(container).style.width).toBe('50%')
    s.setTime(10)
    expect(fillOf(container).style.width).toBe('100%')
  })

  it('the fill and the elapsed readout never disagree', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stub(audioEl2(container), 60)
    s.meta()
    s.setTime(15)
    expect(fillOf(container).style.width).toBe('25%')
    expect(screen.getByText('0:15 / 1:00')).toBeTruthy()
  })

  it('ended drives the fill to exactly 100%', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stub(audioEl2(container), 20)
    s.meta()
    s.setTime(19.6)
    fireEvent(audioEl2(container), new Event('ended'))
    expect(fillOf(container).style.width).toBe('100%')
    expect(screen.getByText('0:20 / 0:20')).toBeTruthy()
  })

  it('stays at 0% and never NaN%% before a duration is known', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    stub(audioEl2(container), NaN)
    fireEvent(audioEl2(container), new Event('loadedmetadata'))
    expect(fillOf(container).style.width).toBe('0%')
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('the rail is tall enough for a real thumb and is direction-pinned for RTL', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const rail = fillOf(container).parentElement as HTMLElement
    // h-3, not h-1: the 4px box is what produced a full-width degenerate thumb.
    expect(rail.getAttribute('class')).toContain('h-3')
    expect(rail.getAttribute('dir')).toBe('ltr')
    const input = container.querySelector('input[type=range]') as HTMLInputElement
    expect(input.getAttribute('class')).toContain('appearance-none')
    expect(input.getAttribute('class')).toContain('slider-thumb')
  })

  it('seeking moves the fill with the element', () => {
    const { container } = render(<WhatsappAttachment messageId={1} attachment={audioAttachment} />)
    const s = stub(audioEl2(container), 40)
    s.meta()
    fireEvent.change(container.querySelector('input[type=range]') as HTMLInputElement, { target: { value: '30' } })
    expect(audioEl2(container).currentTime).toBe(30)
    expect(fillOf(container).style.width).toBe('75%')
  })
})
