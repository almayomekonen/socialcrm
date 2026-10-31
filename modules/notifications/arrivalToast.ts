import { toast } from '@/lib/toast'
import type { Translator } from '@/lib/i18n/translate'
import { storedTextIn } from './display'
import type { NotificationFeedItem } from './types'

/**
 * Show the toast for rows that just arrived (selected by `selectToastable`).
 * Moved out of NotificationContext unchanged in behaviour (i18n Phase F3), so
 * its wording can follow the interface language: one arrival shows its own
 * sentence, worded like its row (`storedTextIn`; Hebrew = the stored text);
 * several show one counted summary (digits, so Hebrew prints what it printed).
 */
export function toastArrivals(fresh: NotificationFeedItem[], t: Translator, push: (href: string) => void) {
  if (fresh.length === 1) {
    const item = fresh[0]
    toast('message', storedTextIn(item, 'title', t.locale)!.text, 6000, () => push(item.deepLink))
  } else {
    /**
     * ONE summary, never N toasts: `toast()` is single-slot (a second call
     * replaces the first), so surfacing several individually would show only
     * the last one and flicker through the rest. Triage, never dump.
     *
     * It goes to the center rather than to any one of the notifications,
     * because the summary is about all of them and picking one would be a
     * guess. A single arrival still deep-links to its own entity above.
     */
    toast('message', t('notifications.toast.many', { count: String(fresh.length) }), 6000, () => push('/notifications'))
  }
}
