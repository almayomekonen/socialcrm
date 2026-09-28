'use client'

import { cn } from '@/lib/utils'
import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Reveal text progressively — as a real stream, or as an entrance transition.
 *
 * TWO MODES, AND THEY ARE NOT INTERCHANGEABLE HERE.
 *
 *   fade        every word is in the DOM immediately and fades in. Nothing is
 *               withheld: screen readers read the whole text, it is selectable
 *               and copyable from the first frame. This is a REVEAL.
 *   typewriter  characters are sliced off a string over time, so text that
 *               exists is deliberately not shown yet. This is a SIMULATION of
 *               generation.
 *
 * That distinction decides which one the agent may use. `frontend-experience-
 * guidelines.md` §13 forbids simulating token streaming with timers, and the
 * Agent's answer is validated in full server-side before a word of it may be
 * shown — so typing it out afterwards would be animating a response that
 * finished on the server, which is the exact bad example the guideline names.
 * `AgentAnswerView` therefore uses `fade`, and nothing in the product should
 * use `typewriter` over an already-complete string.
 *
 * `typewriter` stays because the hook also accepts an `AsyncIterable<string>`,
 * where the wait is genuinely inherent and revealing as chunks arrive is honest.
 *
 * THE FADE DURATION IS A CSS VARIABLE, NOT A GLOBAL RULE. The original wrote
 * `animation: fadeIn ${duration}ms` into a `<style>` tag per instance, and every
 * one of those declared the same global `.fade-segment` class — so two answers
 * on screen with different durations fought, last mount winning for both. The
 * keyframes are declared once and each container carries its own timings.
 */

export type Mode = 'typewriter' | 'fade'

export type UseTextStreamOptions = {
  textStream: string | AsyncIterable<string>
  speed?: number
  mode?: Mode
  onComplete?: () => void
  fadeDuration?: number
  segmentDelay?: number
  characterChunkSize?: number
  onError?: (error: unknown) => void
}

export type UseTextStreamResult = {
  displayedText: string
  isComplete: boolean
  segments: { text: string; index: number }[]
  getFadeDuration: () => number
  getSegmentDelay: () => number
  reset: () => void
  startStreaming: () => void
  pause: () => void
  resume: () => void
}

function useTextStream({
  textStream,
  speed = 20,
  mode = 'typewriter',
  onComplete,
  fadeDuration,
  segmentDelay,
  characterChunkSize,
  onError,
}: UseTextStreamOptions): UseTextStreamResult {
  const [displayedText, setDisplayedText] = useState('')
  const [isComplete, setIsComplete] = useState(false)
  const [segments, setSegments] = useState<{ text: string; index: number }[]>([])

  const speedRef = useRef(speed)
  const modeRef = useRef(mode)
  const currentIndexRef = useRef(0)
  const animationRef = useRef<number | null>(null)
  const fadeDurationRef = useRef(fadeDuration)
  const segmentDelayRef = useRef(segmentDelay)
  const characterChunkSizeRef = useRef(characterChunkSize)
  const streamRef = useRef<AbortController | null>(null)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  // Held in a ref so `updateSegments` can report without taking a dependency it
  // would then go stale on — the original captured the first render's callback.
  const onErrorRef = useRef(onError)

  useEffect(() => {
    speedRef.current = speed
    modeRef.current = mode
    fadeDurationRef.current = fadeDuration
    segmentDelayRef.current = segmentDelay
    characterChunkSizeRef.current = characterChunkSize
  }, [speed, mode, fadeDuration, segmentDelay, characterChunkSize])

  useEffect(() => {
    onCompleteRef.current = onComplete
    onErrorRef.current = onError
  }, [onComplete, onError])

  const getChunkSize = useCallback(() => {
    if (typeof characterChunkSizeRef.current === 'number') {
      return Math.max(1, characterChunkSizeRef.current)
    }
    const normalizedSpeed = Math.min(100, Math.max(1, speedRef.current))
    if (modeRef.current === 'typewriter') {
      if (normalizedSpeed < 25) return 1
      return Math.max(1, Math.round((normalizedSpeed - 25) / 10))
    }
    return 1
  }, [])

  const getProcessingDelay = useCallback(() => {
    if (typeof segmentDelayRef.current === 'number') return Math.max(0, segmentDelayRef.current)
    const normalizedSpeed = Math.min(100, Math.max(1, speedRef.current))
    return Math.max(1, Math.round(100 / Math.sqrt(normalizedSpeed)))
  }, [])

  const getFadeDuration = useCallback(() => {
    if (typeof fadeDurationRef.current === 'number') return Math.max(10, fadeDurationRef.current)
    const normalizedSpeed = Math.min(100, Math.max(1, speedRef.current))
    return Math.round(1000 / Math.sqrt(normalizedSpeed))
  }, [])

  const getSegmentDelay = useCallback(() => {
    if (typeof segmentDelayRef.current === 'number') return Math.max(0, segmentDelayRef.current)
    const normalizedSpeed = Math.min(100, Math.max(1, speedRef.current))
    return Math.max(1, Math.round(100 / Math.sqrt(normalizedSpeed)))
  }, [])

  const updateSegments = useCallback((text: string) => {
    if (modeRef.current !== 'fade') return
    try {
      // `navigator` is absent on the server and `Segmenter` in older engines;
      // the whitespace split below is a correct fallback for both.
      const locale = typeof navigator === 'undefined' ? 'en' : navigator.language
      const segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
      setSegments(
        Array.from(segmenter.segment(text)).map((segment, index) => ({ text: segment.segment, index })),
      )
    } catch (error) {
      setSegments(
        text
          .split(/(\s+)/)
          .filter(Boolean)
          .map((word, index) => ({ text: word, index })),
      )
      onErrorRef.current?.(error)
    }
  }, [])

  const markComplete = useCallback(() => {
    if (!completedRef.current) {
      completedRef.current = true
      setIsComplete(true)
      onCompleteRef.current?.()
    }
  }, [])

  const reset = useCallback(() => {
    currentIndexRef.current = 0
    setDisplayedText('')
    setSegments([])
    setIsComplete(false)
    completedRef.current = false
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [])

  const processStringTypewriter = useCallback(
    (text: string) => {
      let lastFrameTime = 0
      const streamContent = (timestamp: number) => {
        const delay = getProcessingDelay()
        if (delay > 0 && timestamp - lastFrameTime < delay) {
          animationRef.current = requestAnimationFrame(streamContent)
          return
        }
        lastFrameTime = timestamp

        if (currentIndexRef.current >= text.length) {
          markComplete()
          return
        }

        const endIndex = Math.min(currentIndexRef.current + getChunkSize(), text.length)
        const newDisplayedText = text.slice(0, endIndex)
        setDisplayedText(newDisplayedText)
        if (modeRef.current === 'fade') updateSegments(newDisplayedText)
        currentIndexRef.current = endIndex

        if (endIndex < text.length) animationRef.current = requestAnimationFrame(streamContent)
        else markComplete()
      }
      animationRef.current = requestAnimationFrame(streamContent)
    },
    [getProcessingDelay, getChunkSize, updateSegments, markComplete],
  )

  const processAsyncIterable = useCallback(
    async (stream: AsyncIterable<string>) => {
      const controller = new AbortController()
      streamRef.current = controller
      let displayed = ''
      try {
        for await (const chunk of stream) {
          if (controller.signal.aborted) return
          displayed += chunk
          setDisplayedText(displayed)
          updateSegments(displayed)
        }
        markComplete()
      } catch (error) {
        markComplete()
        onErrorRef.current?.(error)
      }
    },
    [updateSegments, markComplete],
  )

  const startStreaming = useCallback(() => {
    reset()
    if (typeof textStream === 'string') {
      /**
       * A COMPLETE STRING IN FADE MODE IS REVEALED, NOT DRIP-FED.
       *
       * The original drove this through the typewriter loop, appending one
       * character per frame and re-segmenting each time — so the text existed
       * and was deliberately withheld, which is the behaviour that separates
       * "entrance animation" from "pretending to still be generating". It also
       * meant a screen reader announced the sentence being assembled letter by
       * letter, and a rep could not select a line until it finished.
       *
       * Segmenting once and letting each word's CSS `animation-delay` stagger
       * the fade produces the identical picture with none of that: every word is
       * in the DOM on the first frame, readable, selectable and copyable, and
       * the animation is purely opacity.
       */
      if (modeRef.current === 'fade') {
        setDisplayedText(textStream)
        updateSegments(textStream)
        markComplete()
        return
      }
      processStringTypewriter(textStream)
    } else if (textStream) {
      processAsyncIterable(textStream)
    }
  }, [textStream, reset, processStringTypewriter, processAsyncIterable, updateSegments, markComplete])

  const pause = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [])

  const resume = useCallback(() => {
    if (typeof textStream === 'string' && !isComplete) processStringTypewriter(textStream)
  }, [textStream, isComplete, processStringTypewriter])

  useEffect(() => {
    startStreaming()
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (streamRef.current) streamRef.current.abort()
    }
  }, [textStream, startStreaming])

  return {
    displayedText,
    isComplete,
    segments,
    getFadeDuration,
    getSegmentDelay,
    reset,
    startStreaming,
    pause,
    resume,
  }
}

export type ResponseStreamProps = {
  textStream: string | AsyncIterable<string>
  mode?: Mode
  /** 1–100, where 1 is slowest and 100 is fastest. */
  speed?: number
  className?: string
  onComplete?: () => void
  as?: keyof React.JSX.IntrinsicElements
  /** Fade duration in ms; overrides `speed`. */
  fadeDuration?: number
  /** Delay between segments in ms; overrides `speed`. */
  segmentDelay?: number
  /**
   * Milliseconds to wait before this instance's FIRST segment fades in.
   *
   * Every instance otherwise starts its stagger at zero, so several of them
   * mounted in the same frame all reveal their first word together and the
   * block lands at once instead of running down the page. A caller that renders
   * a sequence — a headline and the lines under it — passes each one the time
   * the ones above it need, and the reveal reads as a single pass through the
   * whole answer rather than as every paragraph arriving simultaneously.
   *
   * Purely additive to each segment's own delay; it changes when the animation
   * starts, never whether the text is present. `fade` puts every word in the DOM
   * on the first frame regardless, so a delayed block is still selectable,
   * copyable and readable to a screen reader before it is visible.
   */
  startDelay?: number
  /** Characters per frame in typewriter mode; overrides `speed`. */
  characterChunkSize?: number
}

const STYLE_ID = 'response-stream-fade'

/**
 * `.response-stream-reveal` is the same fade WITHOUT `display: inline-block`, for
 * the chrome that belongs to a revealed line rather than for the words in it —
 * a bullet, a card. The segment rule cannot be reused there: it blockifies, so
 * it would flatten a flex card into an inline box. Both share the keyframes and
 * both stop under `prefers-reduced-motion`.
 *
 * Declared once, in the document head — NOT inside the container.
 *
 * Rendering a `<style>` child put the CSS into the element's own text content,
 * so a paragraph "containing" the answer also contained a stylesheet: copying
 * the text picked it up, and any code reading `textContent` saw keyframes. It is
 * appended once per document instead, and per-instance timings ride on custom
 * properties rather than on the rule.
 */
const FADE_KEYFRAMES = `
@keyframes responseStreamFadeIn { from { opacity: 0 } to { opacity: 1 } }
.response-stream-segment {
  display: inline-block;
  opacity: 0;
  animation: responseStreamFadeIn var(--rs-fade-duration, 400ms) ease-out forwards;
  animation-delay: var(--rs-delay, 0ms);
}
.response-stream-reveal {
  opacity: 0;
  animation: responseStreamFadeIn var(--rs-fade-duration, 400ms) ease-out forwards;
  animation-delay: var(--rs-delay, 0ms);
}
.response-stream-segment-space { white-space: pre }
@media (prefers-reduced-motion: reduce) {
  .response-stream-segment, .response-stream-reveal { animation: none; opacity: 1 }
}
`

function useFadeStylesheet(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = FADE_KEYFRAMES
    document.head.appendChild(el)
    // Deliberately not removed on unmount: it is a shared, idempotent rule, and
    // tearing it down would break every other instance still on screen.
  }, [enabled])
}

function ResponseStream({
  textStream,
  mode = 'typewriter',
  speed = 20,
  className = '',
  onComplete,
  as = 'div',
  fadeDuration,
  segmentDelay,
  startDelay = 0,
  characterChunkSize,
}: ResponseStreamProps) {
  const animationEndRef = useRef<(() => void) | null>(null)

  const { displayedText, isComplete, segments, getFadeDuration, getSegmentDelay } = useTextStream({
    textStream,
    speed,
    mode,
    onComplete,
    fadeDuration,
    segmentDelay,
    characterChunkSize,
  })

  useEffect(() => {
    animationEndRef.current = onComplete ?? null
  }, [onComplete])

  const handleLastSegmentAnimationEnd = useCallback(() => {
    if (animationEndRef.current && isComplete) animationEndRef.current()
  }, [isComplete])

  useFadeStylesheet(mode === 'fade')

  const Container = as as keyof React.JSX.IntrinsicElements

  if (mode !== 'fade') {
    return <Container className={className}>{displayedText}</Container>
  }

  return (
    <Container className={className}>
      {segments.map((segment, idx) => (
        <span
          key={`${segment.text}-${idx}`}
          className={cn('response-stream-segment', /^\s+$/.test(segment.text) && 'response-stream-segment-space')}
          style={
            {
              '--rs-fade-duration': `${getFadeDuration()}ms`,
              '--rs-delay': `${startDelay + idx * getSegmentDelay()}ms`,
            } as React.CSSProperties
          }
          onAnimationEnd={idx === segments.length - 1 ? handleLastSegmentAnimationEnd : undefined}
        >
          {segment.text}
        </span>
      ))}
    </Container>
  )
}

export { useTextStream, ResponseStream }
