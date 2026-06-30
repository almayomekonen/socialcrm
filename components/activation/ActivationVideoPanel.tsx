'use client'

import { useState } from 'react'

/**
 * The immersive half — the product video as a full-bleed hero surface. No frame,
 * no window chrome, no card: the video IS the experience, edge to edge. A
 * cinematic gradient floor sits beneath it so it's never black (and shows under
 * reduced-motion / load error), and a feathered seam melts the video into the
 * light activation side. The real MP4/WebM drop into /media/video/ — no code change.
 */

const SOURCES = [
  { src: '/media/video/opening.webm', type: 'video/webm' },
  { src: '/media/video/opening.mp4', type: 'video/mp4' },
]
const POSTER = '/media/video/opening-poster.jpg'

export default function ActivationVideoPanel({
  className = '',
  seamColor = '#f4f1fb',
}: {
  className?: string
  seamColor?: string
}) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`relative overflow-hidden ${className}`} aria-hidden='true'>
      {/* Cinematic floor — never black. */}
      <div
        className='absolute inset-0'
        style={{ background: 'radial-gradient(120% 100% at 32% 30%, #1b1944 0%, #0c0a1f 55%, #060614 100%)' }}
      />

      {!failed && (
        <video
          className='absolute inset-0 h-full w-full object-cover motion-reduce:hidden'
          autoPlay
          muted
          loop
          playsInline
          preload='auto'
          poster={POSTER}
          onError={() => setFailed(true)}
        >
          {SOURCES.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      )}

      {/* Feathered seam — the video dissolves into the light panel (right edge in RTL). */}
      <div
        className='pointer-events-none absolute inset-y-0 right-0 w-[26%]'
        style={{ background: `linear-gradient(to right, transparent, ${seamColor})` }}
      />
      {/* Soft top/bottom depth. */}
      <div
        className='pointer-events-none absolute inset-0'
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.22), transparent 18%, transparent 82%, rgba(0,0,0,0.22))' }}
      />
    </div>
  )
}
