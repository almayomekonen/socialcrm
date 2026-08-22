import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { getInboxDelta, getInboxAwareness } from '@/modules/inbox/queries'
import {
  getConversationMessagesAfter,
  getConversationOutboundStatuses,
  type LeadWhatsappMessage,
  type LeadWhatsappMessageStatus,
} from '@/db/inboxMessages'
import { parseInboxFilters } from '@/modules/inbox/filters'

/**
 * The single inbox sync endpoint (used by the one inbox loop): one request →
 * count + list delta + (optional) open-thread delta + awareness items. The client
 * applies the whole response atomically, so badge/list/thread stay consistent.
 * `counts.whatsappUnread` and each changed row's `unread` derive from the same
 * UNREAD_SQL within this request (single source of truth).
 */
export async function GET(req: NextRequest) {
  const started = Date.now()
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  /*
   * TIER 1 READ. This endpoint only reads the agency's own stored rows and
   * stamps presence; it consumes no paid or external resource. Viewing what is
   * already there is exactly what an expired customer keeps, so the
   * product-access gate that used to sit here has been removed.
   *
   * Authentication and tenant isolation are untouched: the 401 above still
   * runs first, and every query below is scoped by the session's agencyId. The
   * Pro gates live where money is spent, at the actions this data links to.
   */

  const url = new URL(req.url)
  const since = url.searchParams.get('since')
  const filters = parseInboxFilters(Object.fromEntries(url.searchParams))

  const [delta, awareness] = await Promise.all([
    getInboxDelta(user.agencyId, user.id, since, filters),
    getInboxAwareness(user.agencyId, user.id, since),
  ])

  let active:
    | { messages: LeadWhatsappMessage[]; latestMessageId: number; statuses: LeadWhatsappMessageStatus[] }
    | undefined
  const convParam = url.searchParams.get('conversation')
  if (convParam) {
    const conversationId = Number(convParam)
    const owns = await db('inbox_conversations').where({ id: conversationId, agencyId: user.agencyId }).first('id')
    if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const after = Number(url.searchParams.get('after')) || 0
    // Statuses mutate OLD rows, so they cannot ride the `id > after` delta.
    const [messages, statuses] = await Promise.all([
      getConversationMessagesAfter(conversationId, after, user.agencyId),
      getConversationOutboundStatuses(conversationId, user.agencyId),
    ])
    active = { messages, latestMessageId: messages.length ? messages[messages.length - 1].id : after, statuses }
  }

  const body = {
    counts: awareness.counts,
    changed: delta.changed,
    active,
    items: awareness.items,
    serverTime: new Date().toISOString(),
    full: delta.full,
  }
  const json = JSON.stringify(body)
  // [inbox-sync] observability (monitoring-only): counts/size/timing, never content.
  console.log(
    `[inbox-sync] agency=${user.agencyId} changed=${delta.changed.length} active=${active?.messages.length ?? 0} bytes=${(json.length / 1024).toFixed(1)} ms=${Date.now() - started}`,
  )
  return new NextResponse(json, { status: 200, headers: { 'content-type': 'application/json' } })
}
