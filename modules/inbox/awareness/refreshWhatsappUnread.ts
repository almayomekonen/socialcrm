/**
 * Pull the live WhatsApp unread count into AwarenessContext.
 *
 * Desktop inbox does this from InboxSyncLoop. Mobile inbox never mounts that
 * loop, and INBOX_DELTA_SYNC is off in production so AwarenessPoller is not
 * running either. Opening a conversation would otherwise leave the שיחות badge
 * on the layout's first-paint number until a full reload.
 *
 * Uses the existing awareness endpoint. `since=now` so the payload is counts
 * only — no toast items.
 */
export async function refreshWhatsappUnread(setCount: (n: number) => void): Promise<void> {
  try {
    const res = await fetch(
      `/api/inbox/awareness?since=${encodeURIComponent(new Date().toISOString())}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return
    const data = (await res.json()) as { counts?: { whatsappUnread?: number } }
    if (typeof data.counts?.whatsappUnread === 'number') setCount(data.counts.whatsappUnread)
  } catch {
    // The mark-read already landed. The badge can catch up on the next refresh.
  }
}
