/**
 * How long a document may stay `rendering`. Pure.
 *
 * The render and the upload finish inside one 60-second function, so anything older
 * belongs to a process that died. Well below the client poller's 5-minute hard stop
 * (InvoicePdfLive), which is what guarantees an open screen sees the row close.
 */
export const RENDER_STALE_MS = 2 * 60 * 1000

export function isRenderStale(createdAt: string | Date, nowMs: number): boolean {
  return nowMs - new Date(createdAt).getTime() > RENDER_STALE_MS
}
