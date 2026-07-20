// Server-side "how long has this lead been waiting" formatting. Computed once on
// the server and passed down as a string so there is no client Date() and no
// hydration mismatch (dashboard spec §9). Supplementary to the recommend reason —
// when no timestamp is known the caller simply omits the line.

type WaitingSource = {
  nextFollowUpAt?: string | Date | null
  createdAt?: string | Date | null
}

/** Earliest known "waiting since" signal in ms, or null when none is available. */
export function waitingSinceMs(lead: WaitingSource): number | null {
  const src = lead.nextFollowUpAt ?? lead.createdAt ?? null
  if (!src) return null
  const ms = new Date(src).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Plain-Hebrew "ממתין …" string; null when there is no timestamp to base it on. */
export function waitingString(sinceMs: number | null, nowMs: number): string | null {
  if (sinceMs == null) return null
  const diff = nowMs - sinceMs
  if (diff < 3_600_000) return 'ממתין זמן קצר'

  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) {
    if (hours === 1) return 'ממתין שעה'
    if (hours === 2) return 'ממתין שעתיים'
    return `ממתין ${hours} שעות`
  }

  const days = Math.floor(diff / 86_400_000)
  if (days === 1) return 'ממתין יום'
  if (days === 2) return 'ממתין יומיים'
  return `ממתין ${days} ימים`
}
