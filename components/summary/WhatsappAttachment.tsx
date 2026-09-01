'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import type { InboxMessageAttachment } from '@/db/inboxMessages'
import WhatsappImageViewer from '@/components/summary/WhatsappImageViewer'
import { claimVoiceNotePlayback, registerVoiceNote } from '@/lib/inbox/voiceNotePlayback'
import {
  attachmentHref,
  fileKindLabel,
  isAudioAttachment,
  clampPlaybackTime,
  isImageAttachment,
  resolveMediaDuration,
  UNNAMED_ATTACHMENT_LABEL,
} from '@/lib/inbox/attachmentDisplay'

/**
 * Inbound WhatsApp media, rendered inside the existing message bubble on both
 * desktop and mobile. One implementation so the two surfaces stay identical.
 *
 * TYPE-AWARE, because a photo is not a download and a voice note is not a file:
 * `image/*` IS the bubble — the picture with its timestamp laid over the corner,
 * opening a viewer on click; `audio/*` is a compact voice-note row; everything
 * else keeps the file card. The decision is made from the `mimeType` already in
 * the safe client shape — no media id, no Meta URL, no sha256 is needed to make
 * it, and none is exposed.
 *
 * Every branch loads from the SAME authenticated proxy route. The browser sends
 * its own session cookie, which is why media renders without weakening the route
 * or minting a public URL. `next/image` is deliberately avoided: its optimizer
 * fetches server-side without the viewer's cookie and would be refused.
 */
export default function WhatsappAttachment({
  messageId,
  attachment,
  timestampLabel,
}: {
  messageId: number
  attachment: InboxMessageAttachment
  /** Pre-formatted time from the message, overlaid on a photo. Never re-derived here. */
  timestampLabel?: string
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)

  const name = attachment.filename ?? UNNAMED_ATTACHMENT_LABEL
  const kind = fileKindLabel(attachment.mimeType)
  const href = attachmentHref(messageId)

  if (isImageAttachment(attachment.mimeType) && !imageFailed) {
    const alt = attachment.filename ?? 'תמונה שהתקבלה בוואטסאפ'
    return (
      <>
        <button
          type='button'
          onClick={() => setViewerOpen(true)}
          aria-label={`הצג את התמונה ${alt}`}
          aria-haspopup='dialog'
          className='relative block overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; the optimizer cannot send the viewer's cookie */}
          <img
            src={href}
            alt={alt}
            loading='lazy'
            decoding='async'
            onError={() => setImageFailed(true)}
            className='block h-auto max-h-[320px] w-auto max-w-full rounded-lg object-contain'
          />
          {timestampLabel && (
            <>
              {/* Gradient only under the corner that carries the time, so the photo
                  itself is never dimmed to make text legible. */}
              <span
                aria-hidden='true'
                className='pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-lg bg-gradient-to-t from-black/55 to-transparent'
              />
              <span
                dir='ltr'
                suppressHydrationWarning
                className='pointer-events-none absolute bottom-1 left-2 text-[10px] leading-none tabular-nums text-white drop-shadow'
              >
                {timestampLabel}
              </span>
            </>
          )}
        </button>
        <WhatsappImageViewer open={viewerOpen} onClose={() => setViewerOpen(false)} src={href} alt={alt} />
      </>
    )
  }

  if (isAudioAttachment(attachment.mimeType) && !audioFailed) {
    return <VoiceNote src={href} onFailed={() => setAudioFailed(true)} timestampLabel={timestampLabel} />
  }

  return (
    <div className='flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5'>
      <Icon name='file' className='size-4 shrink-0 bg-gray-500' />
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm leading-tight text-gray-800' title={name}>
          {name}
        </p>
        {kind && <p className='text-[11px] leading-tight text-gray-500'>{kind}</p>}
      </div>
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        aria-label={`פתח את הקובץ ${name}`}
        className='shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        פתח
      </a>
    </div>
  )
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Compact voice-note row: play/pause, a seekable progress bar, and the elapsed /
 * total time. The native `<audio>` element still does all the work — decoding,
 * buffering, seeking — it is simply not shown, because the browser's default
 * chrome reads as "a file from an application" rather than part of a
 * conversation. No new dependency, no waveform, no transcoding.
 */
function VoiceNote({
  src,
  onFailed,
  timestampLabel,
}: {
  src: string
  onFailed: () => void
  timestampLabel?: string
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  /**
   * WhatsApp semantics: starting one recording stops the other. Registered at
   * the module level rather than through React state because the thing being
   * stopped is a DOM element, and the players are siblings with no shared
   * ancestor. Each instance still owns its element and its position, so the
   * paused one resumes from exactly where it left off.
   */
  const pauseSelfRef = useRef<() => void>(() => {})
  useEffect(() => {
    // The SAME identity must be registered and passed when claiming, or the
    // registry cannot tell the caller apart from the others and the player
    // pauses itself the instant it starts.
    const pauseSelf = () => ref.current?.pause()
    pauseSelfRef.current = pauseSelf
    return registerVoiceNote(pauseSelf)
  }, [])

  const toggle = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (el.paused) {
      claimVoiceNotePlayback(pauseSelfRef.current)
      void el.play().catch(() => {
        setPlaying(false)
        onFailed()
      })
    } else {
      el.pause()
    }
  }, [onFailed])

  /**
   * The ELEMENT is the source of truth. Every displayed value is read back off it
   * inside a media event — never a timer, never wall-clock arithmetic.
   */
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const readDuration = () => {
      let seekableEnd = 0
      try {
        if (el.seekable && el.seekable.length > 0) seekableEnd = el.seekable.end(el.seekable.length - 1)
      } catch {
        seekableEnd = 0
      }
      return resolveMediaDuration(el.duration, seekableEnd)
    }

    const sync = () => {
      const d = readDuration()
      setDuration(d)
      setCurrent(clampPlaybackTime(el.currentTime, d))
    }
    const onPlay = () => {
      // Also claim here: playback can start without our button (e.g. resume).
      claimVoiceNotePlayback(pauseSelfRef.current)
      setPlaying(true)
    }
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      const d = readDuration()
      setDuration(d)
      setCurrent(d)
      setPlaying(false)
    }
    const onError = () => {
      setPlaying(false)
      onFailed()
    }

    const syncEvents = ['loadedmetadata', 'durationchange', 'timeupdate', 'seeking', 'seeked', 'progress'] as const
    for (const ev of syncEvents) el.addEventListener(ev, sync)
    el.addEventListener('play', onPlay)
    el.addEventListener('playing', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    sync()

    return () => {
      for (const ev of syncEvents) el.removeEventListener(ev, sync)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('playing', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
    }
  }, [onFailed])

  const seekable = duration > 0
  const railMax = seekable ? duration : 1
  const pct = seekable ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0

  return (
    <div className='flex w-[230px] max-w-full items-center gap-2'>
      <audio ref={ref} src={src} preload='metadata' className='hidden' />
      <button
        type='button'
        onClick={toggle}
        aria-label={playing ? 'השהה הקלטה' : 'נגן הקלטה'}
        className='flex size-8 shrink-0 items-center justify-center rounded-full bg-solid text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <Icon name={playing ? 'pause' : 'play'} type='sol' className='size-3.5 bg-white' />
      </button>
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        {/*
          `dir='ltr'` so the fill and the native control agree on which end is
          zero. Inside the RTL thread an untagged range fills right-to-left while
          an inset-anchored fill grows left-to-right — they would disagree.

          The rail is 12px tall, NOT the 4px it used to be. At 4px Chrome derives
          a degenerate thumb the full width of the track (measured: 190px wide on
          a 190px track), so the control painted identically at 0%, 50% and 100%
          however correct its `value` was. The visible progress is now an explicit
          element whose width is the real ratio; the input stays for keyboard,
          screen readers and dragging.
        */}
        <div dir='ltr' className='relative flex h-3 items-center'>
          <span aria-hidden='true' className='absolute inset-x-0 h-1 rounded-full bg-gray-200' />
          <span
            aria-hidden='true'
            data-testid='voice-progress-fill'
            style={{ width: `${pct}%` }}
            className='absolute left-0 h-1 rounded-full bg-solid'
          />
          <input
            type='range'
            min={0}
            max={railMax}
            step='any'
            value={clampPlaybackTime(current, railMax)}
            disabled={!seekable}
            aria-label='מיקום בהקלטה'
            onChange={(e) => {
              const el = ref.current
              if (!el || !seekable) return
              const next = clampPlaybackTime(Number(e.target.value), duration)
              el.currentTime = next
              setCurrent(next)
            }}
            className='relative m-0 h-3 w-full cursor-pointer appearance-none bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-solid [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-solid'
          />
        </div>
        <div className='flex items-center justify-between gap-2'>
          <span dir='ltr' className='text-[10px] leading-none tabular-nums text-gray-500'>
            {formatClock(current)} / {formatClock(duration)}
          </span>
          {timestampLabel && (
            <span
              dir='ltr'
              suppressHydrationWarning
              className='text-[10px] leading-none tabular-nums text-gray-500'
            >
              {timestampLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
