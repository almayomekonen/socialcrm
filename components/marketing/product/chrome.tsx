import { cn } from '@/lib/utils'

/**
 * Shared chrome for the code-rendered SocialCRM product surfaces.
 *
 * WHY CODE, NOT SCREENSHOTS. Every product visual on this site is real markup:
 * sharp at any DPI, correct in RTL, a few KB instead of a 430 KB PNG, and — the
 * part that matters most — able to REFLOW on small screens instead of shrinking.
 * Lumen's own hero mockup is a desktop capture scaled down; at 390px its column
 * headers and sidebar labels render sub-6px and it becomes decoration. Measured
 * on its live demo.
 *
 * These surfaces render the LIGHT product UI, because that is what SocialCRM
 * actually looks like. On a dark marketing ground the effect is the software
 * floating in its own light.
 *
 * PRESENTATIONAL ONLY. No data fetching, no server actions, no state, no
 * focusable controls — a decorative table must not put a keyboard user into a
 * dead tab stop. The sample data is obviously illustrative and is not real
 * customer data.
 *
 * The palette mirrors the app's own tokens (`lib/css/main.css`): primary
 * #5e6ad2, ink #0a2540, bg #f6f9fc, border #e3e8ee. Pinned as literals here so
 * the marketing ground can never bleed into a product surface.
 */

export const APP = {
  bg: '#f6f9fc',
  surface: '#ffffff',
  border: '#e3e8ee',
  ink: '#0a2540',
  // Both meet WCAG AA on the #ffffff/#f6f9fc product surfaces: muted 7.2:1,
  // faint 4.6:1. `faint` was #7b8ca1 (3.4:1) and carried real text — owner
  // names, channel sublabels, the composer placeholder — not just decoration.
  muted: '#4a5c72',
  faint: '#5f7185',
  primary: '#5e6ad2',
  primarySoft: '#eeeffb',
  // For brand-coloured TEXT on white or on primarySoft. #5e6ad2 is 4.4:1 on
  // white and 4.1:1 on the tint — both under AA. Matches the app's own
  // `--color-primary-text`.
  primaryText: '#4b53b8',
} as const

/** A product window: title bar + body, on the app's own background. */
export function AppWindow({
  title,
  children,
  className,
  toolbar,
}: {
  title: string
  children: React.ReactNode
  className?: string
  toolbar?: React.ReactNode
}) {
  return (
    <div
      dir='rtl'
      className={cn('flex flex-col overflow-hidden text-[13px] leading-normal', className)}
      style={{ backgroundColor: APP.bg, color: APP.ink }}
    >
      <div
        className='flex items-center justify-between gap-3 border-b px-3.5 py-2.5 sm:px-4'
        style={{ backgroundColor: APP.surface, borderColor: APP.border }}
      >
        <div className='flex min-w-0 items-center gap-2.5'>
          <span
            aria-hidden='true'
            className='grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white'
            style={{ backgroundColor: APP.primary }}
          >
            S
          </span>
          <span className='truncate font-semibold'>{title}</span>
        </div>
        {toolbar}
      </div>
      {children}
    </div>
  )
}

/**
 * Status pill using the product's REAL status vocabulary
 * (`lib/leads/statusStyles.ts`): חדש / בטיפול / מעוניין / סגור / אבוד.
 * These are the labels the application ships; no invented stage names.
 */
export type LeadStatus = 'new' | 'contacted' | 'interested' | 'closed' | 'lost'

export const STATUS: Record<LeadStatus, { label: string; bg: string; text: string; dot: string }> = {
  new: { label: 'חדש', bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  contacted: { label: 'בטיפול', bg: '#fefce8', text: '#a16207', dot: '#eab308' },
  interested: { label: 'מעוניין', bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  closed: { label: 'סגור', bg: '#f3f4f6', text: '#4b5563', dot: '#9ca3af' },
  lost: { label: 'אבוד', bg: '#fef2f2', text: '#dc2626', dot: '#ef4444' },
}

export function StatusPill({ status }: { status: LeadStatus }) {
  const s = STATUS[status]
  return (
    <span
      className='inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap'
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      <span aria-hidden='true' className='size-1.5 rounded-full' style={{ backgroundColor: s.dot }} />
      {s.label}
    </span>
  )
}

/** Channel mark — the three sources the product actually works with. */
export function ChannelMark({
  channel,
  size = 18,
}: {
  channel: 'whatsapp' | 'facebook' | 'instagram'
  size?: number
}) {
  const C = {
    whatsapp: { bg: '#25D366', label: 'וואטסאפ' },
    facebook: { bg: '#1877F2', label: 'פייסבוק' },
    instagram: { bg: 'linear-gradient(45deg,#f09433,#dc2743 55%,#bc1888)', label: 'אינסטגרם' },
  }[channel]

  return (
    <span
      className='inline-grid shrink-0 place-items-center rounded-full'
      style={{ background: C.bg, width: size, height: size }}
    >
      <span className='sr-only'>{C.label}</span>
      <span
        aria-hidden='true'
        style={{
          width: size * 0.58,
          height: size * 0.58,
          backgroundColor: '#fff',
          maskImage: `url(/media/social-icons/${channel}.svg)`,
          WebkitMaskImage: `url(/media/social-icons/${channel}.svg)`,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        }}
      />
    </span>
  )
}

/** Circular initial, matching the app's lead avatars. */
export function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden='true'
      className='grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold'
      style={{ backgroundColor: APP.primarySoft, color: APP.primaryText }}
    >
      {name.trim().charAt(0)}
    </span>
  )
}
