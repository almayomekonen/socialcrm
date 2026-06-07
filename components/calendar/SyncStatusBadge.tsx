import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'

type Status = 'pending' | 'synced' | 'failed' | 'reauth_required'

const MAP: Record<Status, { role: StatusRole; label: string }> = {
  pending: { role: 'info', label: 'מסונכרן…' },
  synced: { role: 'success', label: 'מסונכרן' },
  failed: { role: 'error', label: 'סנכרון נכשל' },
  reauth_required: { role: 'warning', label: 'דרוש חיבור מחדש' },
}

export default function SyncStatusBadge({ status }: { status: Status }) {
  const s = MAP[status]
  return <StatusBadge role={s.role} label={s.label} />
}
