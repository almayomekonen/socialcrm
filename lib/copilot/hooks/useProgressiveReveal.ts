'use client'

import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * Character-by-character reveal of a body of text. Used for fresh assistant
 * turns; hydrated history passes `disabled=true` to short-circuit to instant.
 *
 * Pace is adaptive:
 *   - text < 40 chars: instant (no animation feels right for one-liners)
 *   - 40-100 chars: ~600-800ms reveal
 *   - 400 chars: ~1.6s
 *   - 800 chars (cap): ~2s
 *
 * Punctuation produces a micro-pause (4x slower) so the eye gets a beat at
 * sentence boundaries. Mirrors the cadence of natural reading.
 *
 * Behavioral contract preserved exactly from the inline version this
 * replaced. The only relocation is the file path.
 */
export function useProgressiveReveal(
  text: string,
  disabled?: boolean,
): { revealed: string; isRevealing: boolean } {
  const prefersReduced = usePrefersReducedMotion()

  // Instant reveal for reduced motion, very short text, or hydrated history
  // (`disabled=true`). Hydrated entries must render statically — they're not
  // fresh generations and shouldn't replay the typing animation on every
  // mount.
  const shouldAnimate = !prefersReduced && !disabled && text.length > 40

  const [pos, setPos] = useState(shouldAnimate ? 0 : text.length)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

  // Track text changes (for future streaming: text grows, reveal extends)
  const textRef = useRef(text)
  textRef.current = text

  // Reset on new text identity (new response)
  const textIdRef = useRef(text)
  useEffect(() => {
    if (text !== textIdRef.current) {
      textIdRef.current = text
      if (!shouldAnimate) {
        setPos(text.length)
      } else {
        setPos(0)
      }
    }
  }, [text, shouldAnimate])

  useEffect(() => {
    if (!shouldAnimate) {
      setPos(text.length)
      return
    }

    const totalLen = text.length

    // Adaptive pace: chars-per-ms. Longer text = faster reveal to stay under ~2s.
    // Target: 40-char text = instant, 100-char = ~800ms, 400-char = ~1.6s, 800-char = ~2s
    const targetDurationMs = Math.min(2000, 600 + totalLen * 2.5)
    const baseCharsPerMs = totalLen / targetDurationMs

    function tick(time: number) {
      if (document.hidden) {
        // Skip animation while hidden, resume on next visible frame
        rafRef.current = requestAnimationFrame(tick)
        lastTimeRef.current = 0
        return
      }

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const dt = Math.min(time - lastTimeRef.current, 50) // cap dt to avoid jumps
      lastTimeRef.current = time

      setPos((prev) => {
        if (prev >= textRef.current.length) return prev

        // Base advance
        let advance = baseCharsPerMs * dt

        // Punctuation-aware micro-pause: slow down after sentence-enders
        const currentChar = textRef.current[prev]
        if (currentChar && isPunctuationPause(currentChar)) {
          advance *= 0.25 // 4x slower through punctuation
        }

        const next = Math.min(prev + advance, textRef.current.length)
        return next
      })

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastTimeRef.current = 0
    }
  }, [shouldAnimate, text])

  const displayPos = Math.floor(pos)
  const revealed = text.slice(0, displayPos)
  const isRevealing = displayPos < text.length

  return { revealed, isRevealing }
}

const PAUSE_CHARS = new Set(['.', ',', ';', ':', '!', '?', '—', '–', '\n'])
function isPunctuationPause(char: string): boolean {
  return PAUSE_CHARS.has(char)
}
