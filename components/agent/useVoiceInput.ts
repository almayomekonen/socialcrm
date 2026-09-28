'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Dictation into the composer, plus the five-band level meter beside the mic.
 *
 * REAL SPEECH ONLY. The reference component this is adapted from falls back to
 * a timer that types a canned English sentence into the box when the browser has
 * no SpeechRecognition or the mic is refused — a fabricated user utterance,
 * which is the one thing an assistant surface must never produce. Here there is
 * no fallback: `supported` is false and the caller does not render a mic at all,
 * and a refused permission stops cleanly instead of inventing words.
 *
 * Hebrew by default, because the product is Hebrew. The transcript is appended
 * to whatever the user had already typed rather than replacing it.
 */

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

const BANDS = 5

export function useVoiceInput({
  onTranscript,
  getBaseline,
  lang = 'he-IL',
}: {
  /** Called with the full text the box should now show. */
  onTranscript: (text: string) => void
  /** What was already typed when recording started. */
  getBaseline: () => string
  lang?: string
}) {
  const [supported, setSupported] = useState(false)
  const [recording, setRecording] = useState(false)
  const [levels, setLevels] = useState<number[]>(() => new Array(BANDS).fill(0))

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  // Resolved after mount: `navigator`/`window` are not available during SSR, and
  // deciding on the server would render a mic the browser cannot honour.
  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()) && Boolean(navigator?.mediaDevices?.getUserMedia))
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setRecording(false)
    setLevels(new Array(BANDS).fill(0))
  }, [])

  const start = useCallback(async () => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      // Refused or unavailable. Nothing is typed, nothing is faked.
      return
    }
    streamRef.current = stream
    setRecording(true)

    // Level meter off the live stream — the bars move with the actual voice, so
    // they are a readout, not an animation played while a timer runs.
    try {
      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext
      const ctx: AudioContext = new AudioCtor()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const step = Math.floor(data.length / BANDS)

      const tick = () => {
        analyser.getByteFrequencyData(data)
        const next = new Array(BANDS).fill(0).map((_, i) => {
          let sum = 0
          for (let j = 0; j < step; j++) sum += data[i * step + j]
          return sum / step / 255
        })
        setLevels(next)
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // No meter; dictation still works.
    }

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang

    let baseline = getBaseline()

    recognition.onresult = (event: any) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) final += r[0].transcript
        else interim += r[0].transcript
      }
      if (final) baseline = (baseline ? baseline + ' ' : '') + final
      onTranscript((baseline + (interim ? ' ' + interim : '')).trim())
    }
    recognition.onerror = () => stop()
    recognition.onend = () => stop()

    recognitionRef.current = recognition
    recognition.start()
  }, [getBaseline, lang, onTranscript, stop])

  useEffect(() => stop, [stop])

  return { supported, recording, levels, start, stop }
}
