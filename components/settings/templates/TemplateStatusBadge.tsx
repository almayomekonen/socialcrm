import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import { statusLabel } from '@/lib/whatsapp/templates/statusCopy'
import type { TemplateStatus } from '@/lib/whatsapp/templates/types'

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
  return <StatusBadge role={STATUS_ROLE[status]} label={statusLabel(status)} pulse={status === 'pending'} />
}
