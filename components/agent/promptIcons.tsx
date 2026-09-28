/**
 * Inline SVGs for the composer.
 *
 * Inline rather than the app's `Icon` (a Cloudinary CSS mask) because these sit
 * inside a dark pill at 12–14px and need a `currentColor` stroke, and rather
 * than the reference's cdn.21st.dev URLs because those are other products'
 * brand logos on a third-party CDN — a network dependency in the composer's hot
 * path, for decoration.
 */

export function ArrowUpIcon() {
  return (
    <svg width='12' height='12' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
      <path d='M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  )
}

export function MicIcon() {
  return (
    <svg width='13' height='13' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
      <rect x='5' y='1' width='4' height='7' rx='2' stroke='currentColor' strokeWidth='1.5' />
      <path d='M2.75 6.5V7a4.25 4.25 0 0 0 8.5 0v-.5M7 11.25V13' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}

export function StopIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
      <rect x='3.5' y='3.5' width='7' height='7' rx='1.5' fill='currentColor' />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
      <path d='M7 2.5V11.5M2.5 7H11.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg width='9' height='9' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
      <path d='M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5' stroke='currentColor' strokeWidth='2' strokeLinecap='round' />
    </svg>
  )
}

/** Three bars whose lit count tracks the selected depth. */
export function DepthBarsIcon({ level }: { level: number }) {
  return (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
      <rect x='1.5' y='8' width='2.5' height='4.5' rx='1' fill='currentColor' opacity={1} />
      <rect x='5.75' y='5' width='2.5' height='7.5' rx='1' fill='currentColor' className='transition-opacity duration-300' opacity={level >= 1 ? 1 : 0.3} />
      <rect x='10' y='2' width='2.5' height='10.5' rx='1' fill='currentColor' className='transition-opacity duration-300' opacity={level >= 2 ? 1 : 0.3} />
    </svg>
  )
}

/** Neutral mark beside a mode name — deliberately not a vendor logo. */
export function ModeMarkIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
      <path
        d='M7 1.5l1.5 3.6 3.9.3-3 2.5.95 3.8L7 9.7l-3.35 2 .95-3.8-3-2.5 3.9-.3L7 1.5z'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinejoin='round'
      />
    </svg>
  )
}
