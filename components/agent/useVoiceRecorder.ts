'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { VOICE_MAX_RECORDING_MS, VOICE_MIN_UPLOAD_BYTES, pickRecorderMimeType } from '@/lib/agent/voice/limits'

/**
 * Voice input for the /agent composer: record → upload → transcript.
 *
 *   idle ──start──▶ requesting ──granted──▶ recording ──stop / 2:00──▶ transcribing ──▶ idle
 *                        │                      │                          │
 *                     refused                cancel                     cancel / error
 *                        ▼                      ▼                          ▼
 *                   idle + error           idle (nothing sent)       idle (+ error)
 *
 * THE ONLY OUTPUT IS TEXT, handed to `onTranscript`. The caller puts it in the
 * composer; it is never sent from here. There is no path from this hook to the
 * agent, to a tool, or to an approval — the rep reads the words and presses
 * send like any typed message.
 *
 * REAL AUDIO ONLY. No fallback invents words: if the browser cannot record,
 * `supported` is false and no mic is offered; if the rep refuses the mic,
 * nothing is typed.
 *
 * The browser's MediaRecorder picks the container (WebM on Chrome/Firefox, MP4
 * on Safari); the server checks it from the bytes. Audio never leaves memory
 * except in the one upload, and the server does not keep it.
 *
 * NOTE: ~320 lines, over the 250 soft limit, intentionally. It is one state
 * machine whose refs (stream, recorder, timer, audio context, upload) are torn
 * down together by stop, cancel, errors and unmount; splitting the level meter
 * or the upload into sibling hooks would spread that single teardown across
 * files. Pure rules already live in lib/agent/voice/limits.ts. Next addition:
 * extract the level meter into its own hook first.
 */

export type VoiceStatus = 'idle' | 'requesting' | 'recording' | 'transcribing'

const BANDS = 5
const TRANSCRIBE_URL = '/api/ai/agent/transcribe'

/** Rep-facing Hebrew for every way this can fail. Never a raw browser or provider message. */
export const VOICE_ERRORS = {
  'permission-denied': 'אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן, או להקליד.',
  'no-microphone': 'לא נמצא מיקרופון במכשיר.',
  unsupported: 'הדפדפן הזה לא תומך בהקלטה. אפשר להקליד את ההודעה.',
  'recording-failed': 'ההקלטה נכשלה. אפשר לנסות שוב.',
  'too-short': 'ההקלטה קצרה מדי. אפשר לנסות שוב.',
  'no-speech': 'לא נשמע דיבור בהקלטה.',
  'too-large': 'ההקלטה ארוכה מדי.',
  busy: 'יש כבר תמלול בתהליך.',
  'over-quota': 'הגעת למגבלת השימוש היומית בבינה המלאכותית.',
  unauthorized: 'צריך להתחבר מחדש.',
  unavailable: 'התמלול לא זמין כרגע. אפשר להקליד את ההודעה.',
  network: 'אין חיבור לשרת. ההקלטה לא נשלחה — אפשר לנסות שוב.',
  failed: 'התמלול נכשל. אפשר לנסות שוב או להקליד.',
} as const

export type VoiceErrorCode = keyof typeof VOICE_ERRORS

/** Server error code → rep-facing message key. Anything unknown is a generic failure. */
export function voiceErrorFromServer(code: unknown, status: number): VoiceErrorCode {
  switch (code) {
    case 'no-speech':
    case 'empty-audio':
      return 'no-speech'
    case 'too-large':
      return 'too-large'
    case 'busy':
      return 'busy'
    case 'over-quota':
      return 'over-quota'
    case 'unauthorized':
      return 'unauthorized'
    case 'unsupported-audio':
      return 'unsupported'
    case 'agent-disabled':
    case 'ai-unavailable':
    case 'forbidden':
      return 'unavailable'
  }
  return status === 401 ? 'unauthorized' : 'failed'
}

function errorFromGetUserMedia(err: unknown): VoiceErrorCode {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'permission-denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'no-microphone'
  if (name === 'NotSupportedError' || name === 'TypeError') return 'unsupported'
  return 'recording-failed'
}

export function useVoiceRecorder({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [supported, setSupported] = useState(false)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => new Array(BANDS).fill(0))
  const [error, setError] = useState<VoiceErrorCode | null>(null)

  const statusRef = useRef<VoiceStatus>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const discardRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const uploadRef = useRef<AbortController | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  useEffect(() => { onTranscriptRef.current = onTranscript }, [onTranscript])

  const setPhase = useCallback((next: VoiceStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  // Decided after mount: `navigator` and `MediaRecorder` do not exist during
  // SSR, and deciding there would render a mic the browser cannot honour.
  useEffect(() => {
    setSupported(Boolean(navigator?.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined')
  }, [])

  /** Release the microphone, the meter and the timer. Safe to call twice. */
  const releaseDevice = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setLevels(new Array(BANDS).fill(0))
  }, [])

  const upload = useCallback(async (blob: Blob) => {
    setPhase('transcribing')
    const controller = new AbortController()
    uploadRef.current = controller
    try {
      const res = await fetch(TRANSCRIBE_URL, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
        signal: controller.signal,
        credentials: 'same-origin',
      })
      const data = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null
      if (controller.signal.aborted) return
      if (res.ok && typeof data?.text === 'string' && data.text.trim()) {
        onTranscriptRef.current(data.text.trim())
      } else {
        setError(voiceErrorFromServer(data?.error, res.status))
      }
    } catch {
      // A cancel aborts on purpose and says nothing; anything else is the network.
      if (!controller.signal.aborted) setError('network')
    } finally {
      if (uploadRef.current === controller) uploadRef.current = null
      setPhase('idle')
    }
  }, [setPhase])

  const start = useCallback(async () => {
    // One recording at a time; a double click while the permission prompt is up
    // must not open a second stream.
    if (statusRef.current !== 'idle') return
    setError(null)
    if (!navigator?.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      setError('unsupported')
      return
    }
    setPhase('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      setError(errorFromGetUserMedia(err))
      setPhase('idle')
      return
    }
    // Cancelled while the prompt was open. (Re-read after the await: TS still
    // believes the pre-await narrowing, so the ref is widened explicitly.)
    if ((statusRef.current as VoiceStatus) !== 'requesting') {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    streamRef.current = stream

    let recorder: MediaRecorder
    try {
      const mimeType = pickRecorderMimeType((t) => window.MediaRecorder.isTypeSupported(t))
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch {
      releaseDevice()
      setError('unsupported')
      setPhase('idle')
      return
    }

    chunksRef.current = []
    discardRef.current = false
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onerror = () => {
      discardRef.current = true
      releaseDevice()
      recorderRef.current = null
      setError('recording-failed')
      setPhase('idle')
    }
    recorder.onstop = () => {
      releaseDevice()
      recorderRef.current = null
      const chunks = chunksRef.current
      chunksRef.current = []
      if (discardRef.current) {
        setPhase('idle')
        return
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || '' })
      if (blob.size < VOICE_MIN_UPLOAD_BYTES) {
        setError('too-short')
        setPhase('idle')
        return
      }
      void upload(blob)
    }

    recorderRef.current = recorder
    try {
      // A timeslice so data arrives as it is recorded, not only at stop().
      recorder.start(1000)
    } catch {
      releaseDevice()
      recorderRef.current = null
      setError('recording-failed')
      setPhase('idle')
      return
    }
    setElapsedMs(0)
    setPhase('recording')

    const startedAt = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt
      setElapsedMs(Math.min(elapsed, VOICE_MAX_RECORDING_MS))
      // The hard ceiling: stop and transcribe what was said so far.
      if (elapsed >= VOICE_MAX_RECORDING_MS && recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }, 200)

    // Level meter off the live stream — a readout of the actual voice.
    try {
      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioCtor) {
        const ctx = new AudioCtor()
        audioCtxRef.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 64
        ctx.createMediaStreamSource(stream).connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const step = Math.max(1, Math.floor(data.length / BANDS))
        const tick = () => {
          analyser.getByteFrequencyData(data)
          setLevels(new Array(BANDS).fill(0).map((_, i) => {
            let sum = 0
            for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0
            return sum / step / 255
          }))
          rafRef.current = requestAnimationFrame(tick)
        }
        tick()
      }
    } catch {
      // No meter; recording still works.
    }
  }, [releaseDevice, setPhase, upload])

  /** Finish recording and transcribe it. */
  const stop = useCallback(() => {
    if (statusRef.current !== 'recording') return
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  /** Abandon whatever is in progress. Nothing is uploaded, nothing is typed. */
  const cancel = useCallback(() => {
    const phase = statusRef.current
    if (phase === 'recording') {
      discardRef.current = true
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      else { releaseDevice(); setPhase('idle') }
    } else if (phase === 'requesting') {
      setPhase('idle')
    } else if (phase === 'transcribing') {
      uploadRef.current?.abort()
    }
  }, [releaseDevice, setPhase])

  const clearError = useCallback(() => setError(null), [])

  // Leaving the page mid-recording releases the mic and drops the upload.
  useEffect(() => () => {
    discardRef.current = true
    uploadRef.current?.abort()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop() } catch { /* already stopped */ }
    }
    releaseDevice()
  }, [releaseDevice])

  return {
    supported,
    status,
    elapsedMs,
    levels,
    error,
    errorMessage: error ? VOICE_ERRORS[error] : null,
    start,
    stop,
    cancel,
    clearError,
  }
}
