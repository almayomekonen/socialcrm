'use client'

import { useState } from 'react'

/**
 * The cinematic side — the product itself, embedded in a floating app window, lit
 * by ambient glow. The looping video plays inside the window. Until the optimized
 * assets exist (or under reduced-motion / on load error) a branded placeholder
 * fills the window, so this side is NEVER dead black. Dropping the final
 * MP4/WebM + poster into /media/video/ requires ZERO code change.
 */

const SOURCES = [
  { src: '/media/video/opening.webm', type: 'video/webm' },
  { src: '/media/video/opening.mp4', type: 'video/mp4' },
]
const POSTER = '/media/video/opening-poster.jpg'

const SKELETON = [
  { w: '62%', dot: '#3f20f5' },
  { w: '48%', dot: '#28c840' },
  { w: '70%', dot: '#febc2e' },
  { w: '40%', dot: '#3f20f5' },
  { w: '56%', dot: '#28c840' },
]

export default function ActivationVideoPanel({ className = '' }: { className?: string }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`relative flex items-center justify-center ${className}`} aria-hidden='true'>
      {/* Ambient bloom behind the window. */}
      <div
        className='absolute'
        style={{
          width: '78%',
          height: '64%',
          background:
            'radial-gradient(ellipse, rgba(79,91,213,0.38) 0%, rgba(252,191,73,0.14) 48%, transparent 74%)',
          filter: 'blur(80px)',
          animation: 'act-breathe 7s ease-in-out infinite',
        }}
      />

      {/* Floating product window — slightly turned toward the viewer. */}
      <div
        className='relative w-[80%] max-w-[600px] overflow-hidden rounded-2xl'
        style={{
          aspectRatio: '16 / 10',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 50px 130px rgba(0,0,0,0.62), 0 0 90px rgba(79,91,213,0.20)',
          transform: 'perspective(1600px) rotateY(7deg) rotateX(2deg)',
          background: '#0b0d22',
        }}
      >
        {/* Window chrome. */}
        <div
          className='flex items-center gap-2 px-4 py-3'
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
        >
          <span className='size-3 rounded-full' style={{ background: '#ff5f57' }} />
          <span className='size-3 rounded-full' style={{ background: '#febc2e' }} />
          <span className='size-3 rounded-full' style={{ background: '#28c840' }} />
        </div>

        {/* Window body. */}
        <div className='relative' style={{ height: 'calc(100% - 42px)' }}>
          {/* Branded placeholder — the floor that's always visible. */}
          <div
            className='absolute inset-0 flex flex-col justify-center gap-4 px-8'
            style={{ background: 'linear-gradient(135deg, #0c0a1f 0%, #12142e 55%, #0c0a1f 100%)' }}
          >
            <div
              className='pointer-events-none absolute inset-0'
              style={{
                background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%)',
                backgroundSize: '220% 100%',
                animation: 'act-shimmer 3.2s linear infinite',
              }}
            />
            {SKELETON.map((row, i) => (
              <div key={i} className='flex items-center gap-3'>
                <span className='size-3 flex-none rounded-full' style={{ background: row.dot, opacity: 0.7 }} />
                <span className='h-2.5 rounded-full' style={{ width: row.w, background: 'rgba(255,255,255,0.12)' }} />
                <span className='ml-auto h-2.5 w-10 rounded-full' style={{ background: 'rgba(255,255,255,0.08)' }} />
              </div>
            ))}
          </div>

          {/* The looping video overlays the placeholder once its assets exist. */}
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
        </div>
      </div>
    </div>
  )
}
