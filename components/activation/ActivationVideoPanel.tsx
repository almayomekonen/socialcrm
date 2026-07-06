'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The onboarding explanation video on a clean dark stage. Same centered stage,
 * sizing and aspect as before — only the asset and playback behavior changed:
 * this is an explanation video (audio on, standard controls, replayable), not a
 * silent decorative loop. Autoplay-with-audio is attempted; browsers that block
 * it leave the video paused with controls + poster visible (ready to play) — the
 * user is never shown a blank/broken stage. If the asset errors, the dark stage
 * shows through.
 */

const SOURCES = [{ src: '/media/video/explanation.mp4', type: 'video/mp4' }]
const POSTER = '/media/video/explanation-poster.jpg'

export default function ActivationVideoPanel({ className = '' }: { className?: string }) {
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    // Attempt autoplay WITH audio. If the browser's autoplay policy blocks it,
    // the promise rejects — swallow it (no console error); the video simply stays
    // paused with its controls + poster, ready for the user to press play.
    videoRef.current?.play().catch(() => {})
  }, [])

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`}>
      {/* The dark stage. */}
      <div
        className='absolute inset-0'
        style={{ background: 'radial-gradient(120% 100% at 50% 38%, #17153d 0%, #0c0a1f 56%, #070615 100%)' }}
      />

      {/* The explanation video — same centered stage, sizing and aspect as before. */}
      {!failed && (
        <video
          ref={videoRef}
          className='relative z-10 w-[82%] max-w-[760px] rounded-xl object-contain'
          style={{ aspectRatio: '16 / 9' }}
          autoPlay
          controls
          playsInline
          preload='auto'
          poster={POSTER}
          aria-label='סרטון הסבר על SocialCRM'
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
