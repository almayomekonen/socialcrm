type Platform = 'whatsapp' | 'instagram' | 'facebook'

const TINT: Record<Platform, string> = {
  whatsapp: 'rgba(37,211,102,0.42)',
  instagram: 'rgba(225,48,108,0.38)',
  facebook: 'rgba(24,119,242,0.38)',
}

const TINT_STRONG: Record<Platform, string> = {
  whatsapp: 'rgba(37,211,102,0.62)',
  instagram: 'rgba(225,48,108,0.58)',
  facebook: 'rgba(24,119,242,0.58)',
}

const GLOW: Record<Platform, string> = {
  whatsapp: 'rgba(37,211,102,0.11)',
  instagram: 'rgba(225,48,108,0.10)',
  facebook: 'rgba(24,119,242,0.10)',
}

interface PlatformIconProps {
  platform: Platform
  size?: number
  strong?: boolean
}

export function PlatformIcon({ platform, size = 88, strong = false }: PlatformIconProps) {
  const src = `/media/social-icons/${platform}.svg`
  return (
    <div aria-hidden='true' className='relative' style={{ width: size, height: size }}>
      <div
        className='absolute inset-[16%] rounded-full blur-lg'
        style={{ backgroundColor: GLOW[platform] }}
      />
      <div
        className='absolute inset-0'
        style={{
          backgroundColor: (strong ? TINT_STRONG : TINT)[platform],
          maskImage: `url(${src})`,
          WebkitMaskImage: `url(${src})`,
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
        }}
      />
    </div>
  )
}
