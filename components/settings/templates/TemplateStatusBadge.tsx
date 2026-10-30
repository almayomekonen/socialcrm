import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import { statusLabel } from '@/lib/whatsapp/templates/statusCopy'
import type { TemplateStatus } from '@/lib/whatsapp/templates/types'
import { useT } from '@/lib/i18n/I18nProvider'
import { templateStatusKey } from './templateCopy'

/**
 * Status pill for a ready-made message — a domain wrapper over the unified
 * `StatusBadge`, exactly like `SyncStatusBadge` / `MeetingOutcomeBadge`. The
 * label comes from the Sprint-1 copy registry; no Meta terms, no raw status.
 */
const STATUS_ROLE: Record<TemplateStatus, StatusRole> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'error',
  paused: 'warning',
  disabled: 'neutral',
}

export default function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  const t = useT()
  const key = templateStatusKey(status)
  const label = t.locale === 'he' || !key ? statusLabel(status) : t(key)
  return <StatusBadge role={STATUS_ROLE[status]} label={label} pulse={status === 'pending'} />
}
