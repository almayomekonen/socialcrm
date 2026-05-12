import type { FollowUpPulse } from '@/lib/ai/followUpRules'

type Props = {
  pulse: FollowUpPulse
  label: string
}

export default function FollowUpPulseChip({ pulse, label }: Props) {
  return (
    <span
      data-pulse={pulse}
      aria-label={`מצב מעקב: ${label}`}
      className='inline-flex shrink-0 items-center px-1.5 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600 text-[10px] leading-tight font-medium'
    >
      {label}
    </span>
  )
}
