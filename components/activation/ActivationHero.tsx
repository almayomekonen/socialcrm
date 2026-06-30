'use client'

/**
 * Desktop convergence hero, themed for the LIGHT activation surface: the three
 * channels (white cards, brand-colored glyphs) float and converge — with indigo
 * particles streaming down the beams — into the SocialCRM mark on a clean white
 * plate. Big, calm, alive. Keyframes (act-float / act-breathe) are injected once
 * by ActivationExperience. Desktop-only (mobile uses ActivationBrand).
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

// chip centers → mark center (240, 206) in the 480×400 viewBox
const BEAMS = ['M 70 86 Q 150 220, 240 212', 'M 240 52 Q 240 140, 240 212', 'M 410 86 Q 330 220, 240 212']

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
        width: 78,
        height: 78,
        background: '#ffffff',
        border: '1px solid rgba(15,16,36,0.06)',
        boxShadow: '0 14px 34px rgba(15,16,36,0.12)',
        animation: `act-float 5s ease-in-out ${delay}s infinite`,
        ...style,
      }}
    >
      <Glyph file={file} background={background} size={38} />
    </div>
  )
}

function LightLogo({ size }: { size: number }) {
  return (
    <div className='relative inline-flex items-center justify-center'>
      <div
        className='absolute rounded-full'
        style={{
          inset: -Math.round(size * 0.42),
          background:
            'radial-gradient(circle, rgba(63,32,245,0.16) 0%, rgba(252,191,73,0.10) 42%, transparent 70%)',
          filter: 'blur(42px)',
          animation: 'act-breathe 6s ease-in-out infinite',
        }}
      />
      <div
        className='relative grid place-items-center'
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.28),
          background: '#ffffff',
          boxShadow: '0 26px 60px rgba(15,16,36,0.18), 0 0 0 1px rgba(15,16,36,0.04)',
        }}
      >
        <img
          src='/media/fav.svg'
          alt='SocialCRM'
          width={Math.round(size * 0.6)}
          height={Math.round(size * 0.6)}
          style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}
          draggable={false}
        />
      </div>
    </div>
  )
}

export default function ActivationHero() {
  return (
    <div className='relative mx-auto' style={{ width: 480, height: 400 }} aria-hidden='true'>
      <svg viewBox='0 0 480 400' className='absolute inset-0 h-full w-full' fill='none'>
        {BEAMS.map((d, i) => (
          <g key={d}>
            <path d={d} stroke='rgba(63,32,245,0.18)' strokeWidth='1.5' />
            {[0, 1, 2].map((k) => (
              <circle key={k} r='2.6' fill='#3f20f5' opacity='0.9'>
                <animateMotion dur={`${2.8 + i * 0.3}s`} begin={`${k * 0.95}s`} repeatCount='indefinite' path={d} />
              </circle>
            ))}
          </g>
        ))}
      </svg>

      <Chip file='facebook.svg' background='#1877f2' style={{ left: 32, top: 48 }} delay={0} />
      <Chip file='instagram.svg' background={INSTAGRAM_GRADIENT} style={{ left: '50%', top: 14, marginLeft: -39 }} delay={0.7} />
      <Chip file='whatsapp.svg' background='#25d366' style={{ right: 32, top: 48 }} delay={1.4} />

      <div className='absolute left-1/2' style={{ top: '53%', transform: 'translate(-50%, -50%)' }}>
        <LightLogo size={156} />
      </div>
    </div>
  )
}
