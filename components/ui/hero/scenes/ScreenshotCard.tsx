import Image from 'next/image'

interface ScreenshotCardProps {
  src: string
  alt: string
  /** Tailwind width classes, e.g. 'w-[300px] sm:w-[460px]'. */
  className?: string
  /** Set on the above-the-fold focal screenshot for faster LCP. */
  priority?: boolean
}

// Both product screenshots share ~the same intrinsic ratio (2778×1800).
const INTRINSIC_W = 2778
const INTRINSIC_H = 1800

/**
 * A product screenshot dressed as a browser window (chrome + traffic-light
 * dots). Width is driven by the passed className so it stays responsive; the
 * image keeps its aspect ratio via w-full h-auto.
 */
export function ScreenshotCard({ src, alt, className, priority }: ScreenshotCardProps) {
  return (
    <div
      className={`overflow-hidden rounded-xl bg-white ring-1 ring-black/10 shadow-[0_28px_76px_rgba(23,20,36,0.28)] ${className ?? ''}`}
    >
      <div className='flex items-center gap-1.5 border-b border-black/5 bg-gray-50 px-3 py-2'>
        <span className='size-2.5 rounded-full bg-[#ff5f57]' />
        <span className='size-2.5 rounded-full bg-[#febc2e]' />
        <span className='size-2.5 rounded-full bg-[#28c840]' />
      </div>
      <Image
        src={src}
        alt={alt}
        width={INTRINSIC_W}
        height={INTRINSIC_H}
        priority={priority}
        sizes='(max-width: 640px) 90vw, 520px'
        className='h-auto w-full'
      />
    </div>
  )
}
