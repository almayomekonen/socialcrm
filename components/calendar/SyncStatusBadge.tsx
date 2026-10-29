import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

type Status = 'pending' | 'synced' | 'failed' | 'reauth_required'

/** Role and label by the stored `meetings.sync_status` CODE; the label follows the interface language. */
const MAP: Record<Status, { role: StatusRole; label: MessageKey }> = {
  pending: { role: 'info', label: 'calendar.badge.sync.pending' },
  synced: { role: 'success', label: 'calendar.badge.sync.synced' },
  failed: { role: 'error', label: 'calendar.badge.sync.failed' },
  reauth_required: { role: 'warning', label: 'calendar.badge.sync.reauth_required' },
}

export default function SyncStatusBadge({ status }: { status: Status }) {
  const t = useT()
  const s = MAP[status]
  return <StatusBadge role={s.role} label={t(s.label)} />
}
