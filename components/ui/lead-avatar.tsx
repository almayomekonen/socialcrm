const SIZES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
} as const

/** `fallback` is shown when there is no name; callers in a translated region pass their own. */
export default function LeadAvatar({
  name,
  size = 'sm',
  fallback = 'ל',
}: {
  name: string | null
  size?: keyof typeof SIZES
  fallback?: string
}) {
  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')

  return (
    <span
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center rounded-full bg-primary-tint font-semibold text-primary-text ${SIZES[size]}`}
    >
      {initials || fallback}
    </span>
  )
}
