const SIZES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
} as const

export default function LeadAvatar({ name, size = 'sm' }: { name: string | null; size?: keyof typeof SIZES }) {
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
      {initials || 'ל'}
    </span>
  )
}
