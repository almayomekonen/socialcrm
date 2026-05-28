type Status = 'pending' | 'synced' | 'failed' | 'reauth_required'

const STYLES: Record<Status, { label: string; bg: string; text: string; border: string; dot: string }> = {
  pending: {
    label: 'מסונכרן…',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
  },
  synced: {
    label: 'מסונכרן',
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    dot: 'bg-green-500',
  },
  failed: {
    label: 'סנכרון נכשל',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    dot: 'bg-red-500',
  },
  reauth_required: {
    label: 'דרוש חיבור מחדש',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
}

export default function SyncStatusBadge({ status }: { status: Status }) {
  const s = STYLES[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text} ${s.border}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}
