type Platform = 'whatsapp' | 'instagram' | 'facebook'

// Low-weight brand tints so the glyph reads as an integrated source marker, not a
// sticker. Rendered as a CSS mask of the existing monochrome SVG over a soft glow
// — no white circle, no badge.
const TINT: Record<Platform, string> = {
  whatsapp: 'rgba(37,211,102,0.28)',
  instagram: 'rgba(225,48,108,0.25)',
  facebook: 'rgba(24,119,242,0.25)',
}

// A faint blurred halo behind the glyph so it stays legible where it peeks out
// from behind its lead card and against the light background.
const GLOW: Record<Platform, string> = {
  whatsapp: 'rgba(37,211,102,0.22)',
  instagram: 'rgba(225,48,108,0.20)',
  facebook: 'rgba(24,119,242,0.20)',
}

interface PlatformIconProps {
  platform: Platform
  /** Rendered size in px. */
  size?: number
}

export function PlatformIcon({ platform, size = 88 }: PlatformIconProps) {
  const src = `/media/social-icons/${platform}.svg`
  return (
    <div aria-hidden='true' className='relative' style={{ width: size, height: size }}>
      <div
        className='absolute inset-[12%] rounded-full blur-2xl'
        style={{ backgroundColor: GLOW[platform] }}
      />
      <div
        className='absolute inset-0'
        style={{
          backgroundColor: TINT[platform],
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
