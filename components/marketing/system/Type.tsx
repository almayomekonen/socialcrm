import { cn } from '@/lib/utils'

/**
 * The type scale as components, so a heading cannot be sized by taste.
 *
 * Sizes come from the fluid `clamp()` tokens in `lib/css/marketing.css`. Two
 * deliberate departures from Lumen, both correcting measured defects in the
 * template:
 *
 *  1. MONOTONIC. Lumen renders h1 at 30px and h2 at 36px below 768px — the
 *     primary heading is smaller than the section headings on every phone.
 *     Verified on its live demo. A continuous ramp cannot invert.
 *  2. NO DEAD ZONE. Lumen's h1 holds one size from 320px to 767px because it
 *     steps at breakpoints with no clamp(). Ours scales continuously.
 *
 * Hebrew-first: Assistant's Hebrew glyphs sit on a taller x-height than Latin
 * and carry no ascender/descender rhythm to lean on, so display leading is
 * looser than a Latin scale would use.
 */

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('mkt-caption font-semibold tracking-[0.12em] text-mkt-accent-text', className)}>
      {children}
    </p>
  )
}

const HEADING_SIZE = {
  display: 'mkt-display',
  h1: 'mkt-h1',
  h2: 'mkt-h2',
  h3: 'mkt-h3',
} as const

type HeadingProps = {
  children: React.ReactNode
  className?: string
  id?: string
  /** Visual size, independent of the semantic level. */
  size?: keyof typeof HEADING_SIZE
  as?: 'h1' | 'h2' | 'h3' | 'h4'
}

export function Heading({ children, className, id, size = 'h2', as = 'h2' }: HeadingProps) {
  const Tag = as
  return (
    <Tag id={id} className={cn(HEADING_SIZE[size], 'font-semibold text-balance text-mkt-fg', className)}>
      {children}
    </Tag>
  )
}

export function Lead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mkt-lead text-pretty text-mkt-muted', className)}>{children}</p>
}

export function Body({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mkt-body text-pretty text-mkt-muted', className)}>{children}</p>
}

/** Section intro: eyebrow → heading → lead, at one rhythm. */
export function SectionIntro({
  eyebrow,
  title,
  lead,
  align = 'center',
  headingId,
  as = 'h2',
  size = 'h2',
  className,
}: {
  eyebrow?: string
  title: React.ReactNode
  lead?: React.ReactNode
  align?: 'center' | 'start'
  headingId?: string
  as?: HeadingProps['as']
  size?: HeadingProps['size']
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        align === 'center' ? 'items-center text-center' : 'items-start text-start',
        className,
      )}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Heading as={as} size={size} id={headingId} className={align === 'center' ? 'max-w-3xl' : undefined}>
        {title}
      </Heading>
      {lead && <Lead className={align === 'center' ? 'max-w-2xl' : 'max-w-xl'}>{lead}</Lead>}
    </div>
  )
}
