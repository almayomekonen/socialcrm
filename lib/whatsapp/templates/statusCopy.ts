/**
 * Meta template status / rejection reason → local enum + rep-facing Hebrew.
 *
 * The ONLY place Meta status strings and rejection reasons are interpreted —
 * mirrors `lib/inbox/whatsappErrorCopy.ts`. Nothing downstream (DB column, API,
 * UI) ever sees a raw Meta reason; only the mapped `key` is stored, only the
 * Hebrew text is shown.
 */
import type { RejectionCategory, TemplateStatus } from './types'
import { TEMPLATE_REJECTION_COPY, TEMPLATE_STATUS_LABELS } from './messages'

/**
 * Project a Meta status string onto our closed enum. Only an explicit `APPROVED`
 * is usable; anything unrecognized degrades to `pending` (conservative — never
 * falsely "ready").
 */
export function mapTemplateStatus(metaStatus: string | null | undefined): TemplateStatus {
  switch ((metaStatus ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'REJECTED':
      return 'rejected'
    case 'PAUSED':
      return 'paused'
    case 'DISABLED':
    case 'DELETED':
    case 'PENDING_DELETION':
      return 'disabled'
    default:
      // PENDING, IN_APPEAL, FLAGGED, or anything new/unknown.
      return 'pending'
  }
}

const META_REASON_CATEGORY: Record<string, RejectionCategory> = {
  INVALID_FORMAT: 'invalid_format',
  INVALID_PARAMETER: 'invalid_format',
  TAG_CONTENT_MISMATCH: 'content_mismatch',
  ABUSIVE_CONTENT: 'policy',
  SCAM: 'policy',
  PROMOTIONAL: 'policy',
}

/** Classify a Meta rejection reason at ingestion time → stored key + Hebrew text. */
export function mapRejectionReason(metaReason: string | null | undefined): { key: RejectionCategory; text: string } {
  const key = (metaReason ? META_REASON_CATEGORY[metaReason.toUpperCase()] : undefined) ?? 'generic'
  return { key, text: TEMPLATE_REJECTION_COPY[key] }
}

/**
 * Resolve a stored `rejectionReason` key to its Hebrew line (read path). Null when
 * absent; an unrecognized stored key degrades to generic rather than throwing.
 */
export function failureTextForRejectionKey(key: string | null | undefined): string | null {
  if (!key) return null
  return TEMPLATE_REJECTION_COPY[key as RejectionCategory] ?? TEMPLATE_REJECTION_COPY.generic
}

/** The Hebrew pill label for a local status. */
export function statusLabel(status: TemplateStatus): string {
  return TEMPLATE_STATUS_LABELS[status]
}
