/**
 * The provider call behind /agent voice input.
 *
 * THE REGRESSION THIS PINS: the SDK's high-level `transcribe()` sniffs the
 * format from a list with no WebM or MP4 entry and falls back to `audio/wav`,
 * so Chrome's and Safari's recordings would reach the provider named
 * `audio.wav` and be rejected. The helper therefore calls the model directly
 * with the media type the route verified from the bytes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const doGenerate = vi.hoisted(() => vi.fn())
const transcription = vi.hoisted(() => vi.fn(() => ({ doGenerate })))
const getOpenAIProvider = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ai/providers', () => ({ getOpenAIProvider }))

import { transcribeVoice, VoiceTranscriptionUnavailableError, VOICE_TRANSCRIPTION_MODEL } from '@/lib/agent/voice/transcribe'

const AUDIO = new Uint8Array([1, 2, 3])

beforeEach(() => {
  doGenerate.mockReset().mockResolvedValue({ text: '  שלום עולם  ', warnings: [] })
  transcription.mockClear()
  getOpenAIProvider.mockReset().mockReturnValue({ transcription })
})

describe('transcribeVoice', () => {
  it('uses the configured OpenAI provider and the transcription model', async () => {
    await transcribeVoice({ audio: AUDIO, container: 'webm' })
    expect(transcription).toHaveBeenCalledWith(VOICE_TRANSCRIPTION_MODEL)
    expect(VOICE_TRANSCRIPTION_MODEL).toBe('gpt-4o-transcribe')
  })

  it.each([
    ['webm', 'audio/webm'],
    ['mp4', 'audio/mp4'],
    ['ogg', 'audio/ogg'],
  ] as const)('passes an explicit media type for %s (never the SDK wav fallback)', async (container, mediaType) => {
    await transcribeVoice({ audio: AUDIO, container })
    expect(doGenerate).toHaveBeenCalledWith(expect.objectContaining({ audio: AUDIO, mediaType }))
  })

  it('does not force a language — mixed Hebrew/English stays mixed — and gives a vocabulary hint', async () => {
    await transcribeVoice({ audio: AUDIO, container: 'webm' })
    const opts = doGenerate.mock.calls[0]![0].providerOptions.openai
    expect(opts.language).toBeUndefined()
    expect(opts.prompt).toMatch(/לידים/)
  })

  it('forwards the abort signal', async () => {
    const signal = new AbortController().signal
    await transcribeVoice({ audio: AUDIO, container: 'mp4', abortSignal: signal })
    expect(doGenerate).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: signal }))
  })

  it('returns trimmed text only', async () => {
    expect(await transcribeVoice({ audio: AUDIO, container: 'webm' })).toEqual({ text: 'שלום עולם' })
  })

  it('no OpenAI key configured → a typed unavailable error, no call', async () => {
    getOpenAIProvider.mockReturnValue(null)
    await expect(transcribeVoice({ audio: AUDIO, container: 'webm' })).rejects.toBeInstanceOf(VoiceTranscriptionUnavailableError)
    expect(doGenerate).not.toHaveBeenCalled()
  })
})
