import type { StatusRole } from '@/lib/StatusBadge'
import type { SupportStatus } from './vocabulary'

/**
 * Owner-facing status labels for /admin/support.
 *
 * Customer STATUS_COPY uses "ממתינה לתשובתך" — that addresses the customer and
 * must never appear in the platform-owner inbox. Labels here are the same closed
 * vocabulary, written for the person answering the request.
 */
export const ADMIN_STATUS_COPY: Record<SupportStatus, { label: string; role: StatusRole }> = {
  open: { label: 'חדש', role: 'info' },
  in_progress: { label: 'בטיפול', role: 'warning' },
  waiting_for_customer: { label: 'ממתינה ללקוח', role: 'warning' },
  resolved: { label: 'נסגרה', role: 'success' },
}
