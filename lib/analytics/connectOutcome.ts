import { db } from '@/config/db'

/**
 * Has the SERVER recorded an outcome for a WhatsApp connect attempt since
 * `since`?
 *
 * `/api/whatsapp/embedded-signup` ends every attempt it finishes with one of:
 * `whatsapp_connected_operational` (success), or `whatsapp_connect_failed` with
 * a server `stage` (including a saved connection whose phone is not ready yet).
 * The browser's `abandoned` report is dropped when one of these exists, so a
 * reload during that request can never add a failure beside the real outcome.
 * Client-stage failures are excluded: those clear the marker before reporting.
 */
export async function hasServerConnectOutcomeSince(agencyId: number, since: Date): Promise<boolean> {
  const row = await db('analytics_events')
    .where({ agencyId })
    .where('createdAt', '>=', since)
    .where((q) =>
      q
        .where('event', 'whatsapp_connected_operational')
        .orWhere((failed) =>
          failed.where('event', 'whatsapp_connect_failed').whereRaw(`COALESCE(props->>'stage', '') <> 'client'`),
        ),
    )
    .first('id')
  return !!row
}
