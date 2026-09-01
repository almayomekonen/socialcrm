'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import type { InboxMessageAttachment } from '@/db/inboxMessages'
import WhatsappImageViewer from '@/components/summary/WhatsappImageViewer'
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
  /**
   * Every instance owns its own element and its own state — no shared store, no
   * singleton, and nothing here ever touches another player. Starting a second
   * voice note therefore cannot stop the first: two recordings play at once,
   * which is the behaviour a rep expects when comparing them.
   */
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  const toggle = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (el.paused) {
      void el.play().catch(() => {
        setPlaying(false)
        onFailed()
      })
    } else {
      el.pause()
    }
  }, [onFailed])

  /**
   * The ELEMENT is the source of truth. Every value on screen is read back off it
   * in a media event — never a timer, never wall-clock arithmetic — so the bar
   * cannot drift away from what is actually being heard.
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
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      // Land the bar exactly on the end; the last `timeupdate` usually fires a
      // fraction short, which leaves the track looking unfinished.
      const d = readDuration()
      setDuration(d)
      setCurrent(d)
      setPlaying(false)
    }
    const onError = () => {
      setPlaying(false)
      onFailed()
    }

    for (const ev of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeking', 'seeked', 'progress'] as const) {
      el.addEventListener(ev, sync)
    }
    el.addEventListener('play', onPlay)
    el.addEventListener('playing', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    sync()

    return () => {
      for (const ev of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeking', 'seeked', 'progress'] as const) {
        el.removeEventListener(ev, sync)
      }
      el.removeEventListener('play', onPlay)
      el.removeEventListener('playing', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
    }
  }, [onFailed])

  const seekable = duration > 0
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
      {/* gap-2 rather than gap-1: the numbers were sitting on the rail. */}
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <input
          type='range'
          min={0}
          max={seekable ? duration : 1}
          step='any'
          value={clampPlaybackTime(current, seekable ? duration : 1)}
          disabled={!seekable}
          aria-label='מיקום בהקלטה'
          onChange={(e) => {
            const el = ref.current
            if (!el || !seekable) return
            const next = clampPlaybackTime(Number(e.target.value), duration)
            el.currentTime = next
            // Optimistic, then `seeked` re-reads the element in case it clamped.
            setCurrent(next)
          }}
          className='h-1 w-full cursor-pointer accent-solid'
        />
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
