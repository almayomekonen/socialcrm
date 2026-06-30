'use client'

import { useState } from 'react'

/**
 * The product showcase on a clean dark stage. Just the video — centered with
 * generous whitespace at ~78% of the column, aspect preserved (object-contain,
 * never cropped). NO shadow, NO glow, NO frame, NO border, NO seam — the dark
 * stage meets the light panel at a clean edge. If the video is missing /
 * reduced-motion / errors, the dark stage shows through. The real MP4/WebM drop
 * into /media/video/ with no code change.
 */

const SOURCES = [
  { src: '/media/video/opening.webm', type: 'video/webm' },
  { src: '/media/video/opening.mp4', type: 'video/mp4' },
]
const POSTER = '/media/video/opening-poster.jpg'

export default function ActivationVideoPanel({ className = '' }: { className?: string }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`} aria-hidden='true'>
      {/* The dark stage. */}
      <div
        className='absolute inset-0'
        style={{ background: 'radial-gradient(120% 100% at 50% 38%, #17153d 0%, #0c0a1f 56%, #070615 100%)' }}
      />

      {/* The showcase — just the video, nothing behind or beside it. */}
      {!failed && (
        <video
          className='relative z-10 w-[82%] max-w-[760px] rounded-xl object-contain motion-reduce:hidden'
          style={{ aspectRatio: '16 / 9' }}
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
  )
}
