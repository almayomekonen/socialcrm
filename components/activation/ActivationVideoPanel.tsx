'use client'

import { useState } from 'react'

/**
 * The product showcase on an elegant dark stage. The video is NOT full-bleed —
 * it sits centered with generous whitespace at ~78% of the column, aspect
 * preserved and object-contain so the whole product is visible and never cropped.
 * No browser chrome, no device frame, no border — just the video, lifted off the
 * stage by a soft ambient glow + shadow. The real MP4/WebM drop into /media/video/
 * with no code change (reduced-motion / load error fall back to the dark stage).
 */

const SOURCES = [
  { src: '/media/video/opening.webm', type: 'video/webm' },
  { src: '/media/video/opening.mp4', type: 'video/mp4' },
]
const POSTER = '/media/video/opening-poster.jpg'

export default function ActivationVideoPanel({
  className = '',
  seamColor = '#f4f0fb',
}: {
  className?: string
  seamColor?: string
}) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`} aria-hidden='true'>
      {/* The dark stage. */}
      <div
        className='absolute inset-0'
        style={{ background: 'radial-gradient(120% 100% at 50% 38%, #17153d 0%, #0c0a1f 56%, #070615 100%)' }}
      />
      {/* Ambient bloom that pools behind the showcase. */}
      <div
        className='absolute'
        style={{
          width: '72%',
          height: '56%',
          background:
            'radial-gradient(ellipse, rgba(79,91,213,0.30) 0%, rgba(252,191,73,0.10) 50%, transparent 75%)',
          filter: 'blur(80px)',
          animation: 'act-breathe 7s ease-in-out infinite',
        }}
      />

      {/* The showcase — ~78% of the column, full product visible, never cropped. */}
      <div className='relative z-10 w-[78%] max-w-[680px]' style={{ aspectRatio: '16 / 9' }}>
        <div
          className='absolute inset-0 rounded-xl'
          style={{ background: 'linear-gradient(135deg, #0c0a1f 0%, #15173a 55%, #0c0a1f 100%)' }}
        />
        {!failed && (
          <video
            className='absolute inset-0 h-full w-full rounded-xl object-contain motion-reduce:hidden'
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
      </div>

      {/* Soft seam — the stage melts toward the light panel (right edge in RTL). */}
      <div
        className='pointer-events-none absolute inset-y-0 right-0 w-[14%]'
        style={{ background: `linear-gradient(to right, transparent, ${seamColor})` }}
      />
    </div>
  )
}
