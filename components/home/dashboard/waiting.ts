// Server-side time formatting for the dashboard. Everything here runs once on the
// server and is passed down as plain strings/props, so there is no client Date()
// and no hydration mismatch (dashboard spec §9). Supplementary to the recommend
// reason — when no timestamp is known the caller simply omits the line.

const BUSINESS_TZ = 'Asia/Jerusalem'

type WaitingSource = {
  nextFollowUpAt?: string | Date | null
  statusChangedAt?: string | Date | null
  createdAt?: string | Date | null
}

/** Earliest known "waiting since" signal in ms, or null when none is available. */
export function waitingSinceMs(lead: WaitingSource): number | null {
  const src = lead.nextFollowUpAt ?? lead.statusChangedAt ?? lead.createdAt ?? null
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

/**
 * Start-of-today in the business timezone, as a UTC ms instant. DST-aware: the
 * offset is derived from the actual instant, never hardcoded. Server-only — this
 * is why overdue/today classification is computed here and passed down, not on
 * the client (the Vercel server runs in UTC and the browser in Asia/Jerusalem).
 */
export function startOfBusinessDayMs(nowMs: number, tz: string = BUSINESS_TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(nowMs))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>
  const hour = p.hour === '24' ? 0 : Number(p.hour) // some engines emit '24' for midnight
  const wallAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second))
  const offset = wallAsUtc - nowMs
  const startWall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 0, 0, 0)
  return startWall - offset
}

type UrgencyRow = {
  nextFollowUpAt?: string | Date | null
  status?: string | null
}

export type RowUrgency = { label: string; tone: string; dot: string }

/**
 * Overdue/today/new/waiting classification for a lead row — the same outputs the
 * FollowupsTable used to compute on the client, moved here so the day boundary is
 * business-timezone correct and server-rendered (no hydration mismatch).
 */
export function urgencyOfRow(row: UrgencyRow, nowMs: number, startOfTodayMs: number): RowUrgency {
  const fu = row.nextFollowUpAt ? new Date(row.nextFollowUpAt).getTime() : null
  if (fu != null && !Number.isNaN(fu) && fu <= nowMs) {
    return fu < startOfTodayMs
      ? { label: 'באיחור', tone: 'text-error-text', dot: 'bg-error' }
      : { label: 'להיום', tone: 'text-warning-text', dot: 'bg-warning' }
  }
  if (row.status === 'new') return { label: 'חדש', tone: 'text-primary-text', dot: 'bg-primary' }
  return { label: 'ממתין', tone: 'text-gray-400', dot: 'bg-gray-300' }
}
