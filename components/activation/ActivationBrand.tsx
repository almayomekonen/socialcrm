export const ACTIVATION_BG =
  'radial-gradient(ellipse 120% 80% at 50% 0%, #0c0a1f 0%, #06081a 50%, #04050f 100%)'

const MASK_BASE = {
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
  maskPosition: 'center',
  WebkitMaskPosition: 'center',
  maskSize: 'contain',
  WebkitMaskSize: 'contain',
} as const

const INSTAGRAM_GRADIENT =
  'linear-gradient(45deg, #feda75 0%, #fa7e1e 25%, #d62976 50%, #962fbf 75%, #4f5bd5 100%)'

function ChannelGlyph({ file, background }: { file: string; background: string }) {
  return (
    <span
      aria-hidden='true'
      className='size-6'
      style={{
        background,
        maskImage: `url(/media/social-icons/${file})`,
        WebkitMaskImage: `url(/media/social-icons/${file})`,
        ...MASK_BASE,
      }}
    />
  )
}

function ChannelChip({ file, background, style }: { file: string; background: string; style: React.CSSProperties }) {
  return (
    <div
      className='absolute grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl'
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        backdropFilter: 'blur(12px)',
        ...style,
      }}
    >
      <ChannelGlyph file={file} background={background} />
    </div>
  )
}

export function SocialCrmMark({ size = 76 }: { size?: number }) {
  return (
    <div className='relative inline-flex items-center justify-center'>
      <div
        className='absolute rounded-full animate-pulse'
        style={{
          inset: -Math.round(size * 0.45),
          background: 'radial-gradient(ellipse, rgba(252,191,73,0.45) 0%, rgba(251,146,60,0.15) 38%, transparent 70%)',
          filter: 'blur(26px)',
        }}
      />
      <div
        className='relative grid place-items-center'
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.28),
          background: 'linear-gradient(135deg, #fefcf7 0%, #faf2dc 60%, #f5e6b8 100%)',
          boxShadow: [
            '0 18px 44px rgba(0,0,0,0.55)',
            '0 0 48px rgba(252,191,73,0.28)',
            'inset 0 1px 0 rgba(255,255,255,1)',
            'inset 0 0 0 1px rgba(255,255,255,0.5)',
          ].join(', '),
        }}
      >
        <img
          src='/media/fav.svg'
          alt='SocialCRM'
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62) }}
          draggable={false}
        />
      </div>
    </div>
  )
}

export default function ActivationBrand({ width = 300 }: { width?: number }) {
  const height = Math.round((width * 210) / 300)
  const markSize = Math.round(width * 0.29)
  return (
    <div className='relative mx-auto w-full' style={{ maxWidth: width, height }} aria-hidden='true'>
      <svg viewBox='0 0 300 210' className='absolute inset-0 h-full w-full' fill='none'>
        {[
          'M 45 36 Q 100 116, 150 122',
          'M 150 23 Q 150 78, 150 122',
          'M 255 36 Q 200 116, 150 122',
        ].map((d, i) => (
          <g key={d}>
            <path d={d} stroke='rgba(252,191,73,0.30)' strokeWidth='1.5' />
            <circle r='2' fill='rgba(254,231,156,0.9)'>
              <animateMotion dur={`${2.4 + i * 0.4}s`} repeatCount='indefinite' path={d} />
            </circle>
          </g>
        ))}
      </svg>

      <ChannelChip file='facebook.svg' background='#1877f2' style={{ left: '15%', top: '17%' }} />
      <ChannelChip file='instagram.svg' background={INSTAGRAM_GRADIENT} style={{ left: '50%', top: '11%' }} />
      <ChannelChip file='whatsapp.svg' background='#25d366' style={{ left: '85%', top: '17%' }} />

      <div className='absolute left-1/2 -translate-x-1/2' style={{ top: '58%' }}>
        <SocialCrmMark size={markSize} />
      </div>
    </div>
  )
}
