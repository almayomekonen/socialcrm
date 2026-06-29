'use client'

import { SocialCrmMark } from '@/components/activation/ActivationBrand'

/**
 * Desktop convergence hero — the same idea as the mobile brand, rebuilt big and
 * alive: the SocialCRM mark is the glowing visual center, the three channels
 * float around it, and bright particles stream continuously down the beams INTO
 * the mark. This is the energy the desktop screen was missing.
 *
 * Reuses the product's assets only (fav via SocialCrmMark, the brand glyphs, the
 * amber/indigo palette). Keyframes (act-float / act-breathe) are injected once by
 * ActivationExperience.
 */

const MASK = {
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
  maskPosition: 'center',
  WebkitMaskPosition: 'center',
  maskSize: 'contain',
  WebkitMaskSize: 'contain',
} as const

const INSTAGRAM_GRADIENT =
  'linear-gradient(45deg, #feda75 0%, #fa7e1e 25%, #d62976 50%, #962fbf 75%, #4f5bd5 100%)'

// chip centers → mark center (240, 200), in the 480×380 viewBox
const BEAMS = ['M 70 78 Q 150 210, 240 204', 'M 240 46 Q 240 130, 240 204', 'M 410 78 Q 330 210, 240 204']

function Glyph({ file, background, size }: { file: string; background: string; size: number }) {
  return (
    <span
      aria-hidden='true'
      style={{
        width: size,
        height: size,
        background,
        maskImage: `url(/media/social-icons/${file})`,
        WebkitMaskImage: `url(/media/social-icons/${file})`,
        ...MASK,
      }}
    />
  )
}

function Chip({
  file,
  background,
  style,
  delay,
}: {
  file: string
  background: string
  style: React.CSSProperties
  delay: number
}) {
  return (
    <div
      className='absolute grid place-items-center rounded-2xl'
      style={{
        width: 76,
        height: 76,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 14px 44px rgba(0,0,0,0.45)',
        animation: `act-float 5s ease-in-out ${delay}s infinite`,
        ...style,
      }}
    >
      <Glyph file={file} background={background} size={36} />
    </div>
  )
}

export default function ActivationHero() {
  return (
    <div className='relative mx-auto' style={{ width: 480, height: 380 }} aria-hidden='true'>
      {/* Ambient halo — amber core bleeding into indigo, breathing. */}
      <div
        className='absolute left-1/2 top-[54%] -translate-x-1/2 -translate-y-1/2'
        style={{
          width: 460,
          height: 460,
          background:
            'radial-gradient(circle, rgba(252,191,73,0.30) 0%, rgba(79,91,213,0.14) 45%, transparent 70%)',
          filter: 'blur(54px)',
          animation: 'act-breathe 6s ease-in-out infinite',
        }}
      />

      {/* Converging beams + streaming particles. */}
      <svg viewBox='0 0 480 380' className='absolute inset-0 h-full w-full' fill='none'>
        {BEAMS.map((d, i) => (
          <g key={d}>
            <path d={d} stroke='rgba(252,191,73,0.32)' strokeWidth='1.5' />
            {[0, 1, 2].map((k) => (
              <circle key={k} r='2.6' fill='rgba(254,231,156,0.95)'>
                <animateMotion dur={`${2.8 + i * 0.3}s`} begin={`${k * 0.95}s`} repeatCount='indefinite' path={d} />
              </circle>
            ))}
          </g>
        ))}
      </svg>

      {/* Channels — floating around the mark. */}
      <Chip file='facebook.svg' background='#1877f2' style={{ left: 32, top: 40 }} delay={0} />
      <Chip file='instagram.svg' background={INSTAGRAM_GRADIENT} style={{ left: '50%', top: 8, marginLeft: -38 }} delay={0.7} />
      <Chip file='whatsapp.svg' background='#25d366' style={{ right: 32, top: 40 }} delay={1.4} />

      {/* The workspace they converge into — the visual center. */}
      <div className='absolute left-1/2' style={{ top: '54%', transform: 'translate(-50%, -50%)' }}>
        <SocialCrmMark size={156} />
      </div>
    </div>
  )
}
