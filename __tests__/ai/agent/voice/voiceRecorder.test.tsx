// @vitest-environment jsdom
/**
 * /agent voice input in the browser: the recorder's state machine, the
 * composer, and the safety property the feature rests on.
 *
 * The browser APIs (getUserMedia, MediaRecorder) and `fetch` are faked; the
 * hook, the composer and the conversation hook all run for real.
 *
 * SAFETY: a transcript lands in the composer and is NEVER sent by the voice
 * path. Only the rep pressing send submits it — through the same request, to
 * the same route, with the same body shape as typed text. No voice flag, no
 * intent, nothing the server could read as extra authority.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useVoiceRecorder, VOICE_ERRORS } from '@/components/agent/useVoiceRecorder'
import AgentWorkspace from '@/components/agent/AgentWorkspace'
import { VOICE_MAX_RECORDING_MS } from '@/lib/agent/voice/limits'

const TRANSCRIBE = '/api/ai/agent/transcribe'
const STREAM = '/api/ai/agent/stream'
const SPOKEN = 'תיצור לי משימה לחזור לדני מחר'

// ── Fake browser recording ────────────────────────────────────────────────────

const track = { stop: vi.fn() }
let recorders: FakeRecorder[] = []
let recordingBytes = 4_096

class FakeRecorder {
  static isTypeSupported = vi.fn((t: string) => t.startsWith('audio/webm'))
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm'
    recorders.push(this)
  }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(recordingBytes)], { type: this.mimeType }) })
    this.onstop?.()
  }
}

const getUserMedia = vi.fn()
const fetchSpy = vi.fn()

function transcribeReply(status: number, body: Record<string, unknown>) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, body: null } as unknown as Response
}

beforeEach(() => {
  recorders = []
  recordingBytes = 4_096
  track.stop.mockClear()
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  fetchSpy.mockReset().mockImplementation(async (url: string) => {
    if (url === TRANSCRIBE) return transcribeReply(200, { text: SPOKEN })
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fetchSpy)
  // jsdom has no matchMedia; the thread reads prefers-reduced-motion once a turn renders.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  // …nor scrollIntoView, which the thread calls to follow a new turn.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const transcribeCalls = () => fetchSpy.mock.calls.filter(([u]) => u === TRANSCRIBE)
const streamCalls = () => fetchSpy.mock.calls.filter(([u]) => u === STREAM)

// ── The state machine ─────────────────────────────────────────────────────────

describe('useVoiceRecorder — state machine', () => {
  it('is supported only when the browser can record', async () => {
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript: vi.fn() }))
    await waitFor(() => expect(result.current.supported).toBe(true))

    vi.stubGlobal('MediaRecorder', undefined)
    const { result: none } = renderHook(() => useVoiceRecorder({ onTranscript: vi.fn() }))
    await waitFor(() => expect(none.current.supported).toBe(false))
  })

  it('idle → recording; a double start opens the microphone once', async () => {
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript: vi.fn() }))
    await act(async () => { void result.current.start(); await result.current.start() })
    expect(result.current.status).toBe('recording')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(recorders).toHaveLength(1)
    // Runtime format choice: WebM/Opus where supported.
    expect(recorders[0]!.mimeType).toBe('audio/webm;codecs=opus')
  })

  it('recording → stop → transcribing → idle, handing over the transcript', async () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript }))
    await act(async () => { await result.current.start() })
    act(() => result.current.stop())
    expect(result.current.status).toBe('transcribing')
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(onTranscript).toHaveBeenCalledWith(SPOKEN)
    const [, init] = transcribeCalls()[0]!
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('audio/webm;codecs=opus')
    expect(init.body).toBeInstanceOf(Blob)
    // The microphone is released.
    expect(track.stop).toHaveBeenCalled()
  })

  it('cancel while recording: nothing uploaded, nothing typed, mic released', async () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript }))
    await act(async () => { await result.current.start() })
    act(() => result.current.cancel())
    expect(result.current.status).toBe('idle')
    expect(transcribeCalls()).toHaveLength(0)
    expect(onTranscript).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
  })

  it('cancel while transcribing: the upload is aborted and nothing is typed', async () => {
    fetchSpy.mockImplementation((_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript }))
    await act(async () => { await result.current.start() })
    act(() => result.current.stop())
    expect(result.current.status).toBe('transcribing')
    await act(async () => { result.current.cancel() })
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(onTranscript).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it('permission denied: a clear message, back to idle, nothing recorded', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript: vi.fn() }))
    await act(async () => { await result.current.start() })
    expect(result.current.status).toBe('idle')
    expect(result.current.errorMessage).toBe(VOICE_ERRORS['permission-denied'])
    expect(recorders).toHaveLength(0)
  })

  it('no microphone: its own message', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }))
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript: vi.fn() }))
    await act(async () => { await result.current.start() })
    expect(result.current.errorMessage).toBe(VOICE_ERRORS['no-microphone'])
  })

  it('transcription failure: a message, and no transcript', async () => {
    fetchSpy.mockResolvedValue(transcribeReply(502, { error: 'transcription-failed' }))
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript }))
    await act(async () => { await result.current.start() })
    act(() => result.current.stop())
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(onTranscript).not.toHaveBeenCalled()
    expect(result.current.errorMessage).toBe(VOICE_ERRORS.failed)
  })

  it('network failure: a message that says nothing was sent', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript: vi.fn() }))
    await act(async () => { await result.current.start() })
    act(() => result.current.stop())
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.errorMessage).toBe(VOICE_ERRORS.network)
  })

  it('a recording too short to be speech is not uploaded', async () => {
    recordingBytes = 10
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript: vi.fn() }))
    await act(async () => { await result.current.start() })
    act(() => result.current.stop())
    expect(result.current.errorMessage).toBe(VOICE_ERRORS['too-short'])
    expect(transcribeCalls()).toHaveLength(0)
  })

  it('stops itself at the maximum duration and transcribes what was said', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onTranscript }))
    await act(async () => { await result.current.start() })
    expect(result.current.status).toBe('recording')
    await act(async () => { vi.advanceTimersByTime(VOICE_MAX_RECORDING_MS - 1_000) })
    expect(result.current.status).toBe('recording')
    await act(async () => { vi.advanceTimersByTime(1_200) })
    expect(transcribeCalls()).toHaveLength(1)
    vi.useRealTimers()
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith(SPOKEN))
  })
})

// ── The composer and the safety property ─────────────────────────────────────

const textarea = () => screen.getByLabelText('שאל את הסוכן') as HTMLTextAreaElement

describe('the /agent composer — voice is an input method only', () => {
  it('the transcript lands in the composer and is NOT sent', async () => {
    render(<AgentWorkspace />)
    const mic = await screen.findByRole('button', { name: 'הקלטה קולית' })
    await act(async () => { fireEvent.click(mic) })
    expect(await screen.findByText('מקליט')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'עצירת ההקלטה ותמלול' }))
    await waitFor(() => expect(textarea().value).toBe(SPOKEN))
    expect(streamCalls()).toHaveLength(0)
  })

  it('recording from the collapsed composer expands it, so the status row never sits on the placeholder', async () => {
    render(<AgentWorkspace />)
    const opener = screen.getByRole('button', { name: 'פתיחת תיבת ההודעה' })
    expect(opener.className).toContain('opacity-100')
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'הקלטה קולית' })) })
    expect(await screen.findByText('מקליט')).toBeInTheDocument()
    expect(opener.className).toContain('opacity-0')
    expect(textarea().className).toContain('opacity-100')
  })

  it('an existing draft is kept; the transcript is appended after it', async () => {
    render(<AgentWorkspace />)
    await screen.findByRole('button', { name: 'הקלטה קולית' })
    fireEvent.change(textarea(), { target: { value: 'לגבי דני כהן:' } })
    // With a draft present, the action button is "send"; recording more is the small mic beside it.
    const smallMic = await screen.findByRole('button', { name: 'הקלטה קולית' })
    await act(async () => { fireEvent.click(smallMic) })
    fireEvent.click(await screen.findByRole('button', { name: 'עצירת ההקלטה ותמלול' }))
    await waitFor(() => expect(textarea().value).toBe(`לגבי דני כהן: ${SPOKEN}`))
    expect(streamCalls()).toHaveLength(0)
  })

  it('a failed transcription leaves the draft exactly as it was', async () => {
    fetchSpy.mockImplementation(async () => transcribeReply(502, { error: 'transcription-failed' }))
    render(<AgentWorkspace />)
    await screen.findByRole('button', { name: 'הקלטה קולית' })
    fireEvent.change(textarea(), { target: { value: 'טיוטה חשובה' } })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'הקלטה קולית' })) })
    fireEvent.click(await screen.findByRole('button', { name: 'עצירת ההקלטה ותמלול' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(VOICE_ERRORS.failed)
    expect(textarea().value).toBe('טיוטה חשובה')
  })

  it('SAFETY: voice → composer → the rep edits and sends → the ordinary stream request, nothing else', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === TRANSCRIBE) return transcribeReply(200, { text: SPOKEN })
      if (url === STREAM) return { ok: true, status: 200, body: new ReadableStream({ start(c) { c.close() } }), json: async () => ({}) } as unknown as Response
      throw new Error(url)
    })
    render(<AgentWorkspace />)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'הקלטה קולית' })) })
    fireEvent.click(await screen.findByRole('button', { name: 'עצירת ההקלטה ותמלול' }))
    await waitFor(() => expect(textarea().value).toBe(SPOKEN))

    // Nothing has gone to the agent yet — the transcript is only text in a box.
    expect(streamCalls()).toHaveLength(0)

    // The rep edits it, then presses the ordinary send button.
    fireEvent.change(textarea(), { target: { value: `${SPOKEN} בשעה 10` } })
    fireEvent.click(screen.getByRole('button', { name: 'שליחה' }))
    await waitFor(() => expect(streamCalls()).toHaveLength(1))

    const [, init] = streamCalls()[0]!
    const sent = JSON.parse(String((init as RequestInit).body))
    // Exactly what typed text sends: the edited question and the history. No
    // voice marker, no intent, nothing the server could treat as authority.
    expect(Object.keys(sent).sort()).toEqual(['history', 'question'])
    expect(sent.question).toBe(`${SPOKEN} בשעה 10`)
    // The transcription endpoint was called once, and never with anything but audio.
    expect(transcribeCalls()).toHaveLength(1)
  })
})
