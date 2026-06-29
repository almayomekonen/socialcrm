'use client'



const SOURCES = [
  { src: '/media/video/opening.webm', type: 'video/webm' },
  { src: '/media/video/opening.mp4', type: 'video/mp4' },
]
const POSTER = '/media/video/opening-poster.jpg'

export default function ActivationVideoPanel({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`} aria-hidden='true'>
      <video
        className='h-full w-full object-cover motion-reduce:hidden'
        autoPlay
        muted
        loop
        playsInline
        preload='auto'
        poster={POSTER}
      >
        {SOURCES.map((s) => (
          <source key={s.src} src={s.src} type={s.type} />
        ))}
      </video>
      {/* Reduced-motion: static poster only (video hidden above via motion-reduce). */}
      <img src={POSTER} alt='' className='hidden h-full w-full object-cover motion-reduce:block' />
      {/* Seam gradient blending the video into the dark activation panel. */}
      <div
        className='pointer-events-none absolute inset-0'
        style={{ background: 'linear-gradient(90deg, transparent 72%, rgba(4,5,15,0.55) 100%)' }}
      />
    </div>
  )
}
