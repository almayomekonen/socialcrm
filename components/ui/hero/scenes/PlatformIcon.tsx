type Platform = 'whatsapp' | 'instagram' | 'facebook'

// Low-weight brand tints (alpha baked in) so the glyph reads as an ambient source,
// not a sticker. Rendered as a CSS mask of the existing monochrome SVG — no white
// circle, no badge, just the tinted silhouette.
const TINT: Record<Platform, string> = {
  whatsapp: 'rgba(37,211,102,0.22)',
  instagram: 'rgba(225,48,108,0.20)',
  facebook: 'rgba(24,119,242,0.20)',
}

interface PlatformIconProps {
  platform: Platform
  /** Rendered size in px (70–100 range). */
  size?: number
}

export function PlatformIcon({ platform, size = 88 }: PlatformIconProps) {
  const src = `/media/social-icons/${platform}.svg`
  return (
    <div
      aria-hidden='true'
      style={{
        width: size,
        height: size,
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
  )
}
