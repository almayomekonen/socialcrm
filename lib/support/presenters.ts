import type { StatusRole } from '@/lib/StatusBadge'
import { AUTHOR_LABEL, STATUS_COPY } from './copy'
import type { SupportAuthorKind, SupportStatus } from './vocabulary'

/**
 * Row -> view model. This is where everything the customer must not see is
 * dropped, structurally rather than by discipline.
 *
 * Two things are enforced here and cannot be undone downstream:
 *
 *   1. `authorUserId` never leaves. The platform owner's identity is stored for
 *      internal attribution and the customer always reads "צוות SocialCRM".
 *      The view model has no such field, so rendering it is a compile error.
 *
 *   2. The request list carries THREE things: what they asked about, where it
 *      stands, and when it last moved. No category, no ids, no diagnostics —
 *      a list of technical metadata is a helpdesk dashboard, which this is not.
 */

export type ThreadMessageView = {
  id: number
  authorKind: SupportAuthorKind
  authorLabel: string
  body: string
  createdAt: Date
}

export type RequestSummaryView = {
  id: number
  subject: string
  statusLabel: string
  statusRole: StatusRole
  lastActivityAt: Date | null
}

export function toThreadMessages(
  rows: Array<{
    id: number
    authorKind: SupportAuthorKind
    authorUserId: number | null
    body: string
    createdAt: Date
  }>,
  viewerUserId: number,
  /** Shown when a workspace admin is reading a colleague's request. */
  requesterName?: string,
): ThreadMessageView[] {
  return (rows ?? [])
    // An opening message may legitimately be empty: the customer wrote nothing
    // because SocialCRM had already resolved the context, and the context card
    // carries the meaning. Dropping it here is what stops a blank bubble from
    // ever reaching the thread.
    .filter((r) => (r.body ?? '').trim().length > 0)
    .map((r) => ({
      id: r.id,
      authorKind: r.authorKind,
      authorLabel:
        r.authorKind === 'customer'
          ? r.authorUserId === viewerUserId
            ? AUTHOR_LABEL.self
            : requesterName || AUTHOR_LABEL.self
          : AUTHOR_LABEL.support,
      body: r.body,
      createdAt: r.createdAt,
    }))
}

export function toRequestSummaries(
  rows: Array<{
    id: number
    subject: string
    status: SupportStatus
    lastMessageAt: Date | null
  }>,
  _viewerUserId: number,
): RequestSummaryView[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    subject: r.subject,
    statusLabel: STATUS_COPY[r.status].label,
    statusRole: STATUS_COPY[r.status].role,
    lastActivityAt: r.lastMessageAt,
  }))
}
