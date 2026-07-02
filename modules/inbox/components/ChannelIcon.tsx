import { MessageSquare } from 'lucide-react'

/**
 * Channel glyph for list rows, headers and empty states. WhatsApp renders the
 * project's existing brand SVG (public/media/social-icons) via the CSS-mask +
 * tint technique already used by the marketing PlatformIcon — no new assets.
 * Registry-style like channels.ts: adding a channel = one entry here; unknown
 * channels fall back to a neutral glyph so new channels render with zero UI changes.
 */
const CHANNEL_GLYPHS: Record<string, { src: string; color: string }> = {
  whatsapp: { src: '/media/social-icons/whatsapp.svg', color: 'var(--color-success)' },
}

export default function ChannelIcon({ channel, className = 'size-3.5' }: { channel: string; className?: string }) {
  const glyph = CHANNEL_GLYPHS[channel]
  if (!glyph) return <MessageSquare aria-hidden className={`shrink-0 text-gray-400 ${className}`} />

  const mask = `url(${glyph.src})`
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={{
        backgroundColor: glyph.color,
        maskImage: mask,
        WebkitMaskImage: mask,
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
