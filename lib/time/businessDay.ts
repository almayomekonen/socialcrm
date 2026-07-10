export const BUSINESS_TZ = 'Asia/Jerusalem'

export type Urgency = { label: string; tone: string }

function tzOffsetMs(instantMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs))
  const m: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value
  const wallAsUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second)
  return wallAsUTC - instantMs
}

export function startOfBusinessDay(instantMs: number, tz: string = BUSINESS_TZ): number {
  const wall = new Date(instantMs + tzOffsetMs(instantMs, tz))
  const midnightWallAsUTC = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), 0, 0, 0)
  const offsetAtMidnight = tzOffsetMs(midnightWallAsUTC - tzOffsetMs(instantMs, tz), tz)
  return midnightWallAsUTC - offsetAtMidnight
}

export function isBeforeBusinessDay(whenMs: number, nowMs: number, tz: string = BUSINESS_TZ): boolean {
  return startOfBusinessDay(whenMs, tz) < startOfBusinessDay(nowMs, tz)
}

export function classifyUrgency(input: { nextFollowUpAt: string | Date | null; status: string | null }, nowMs: number): Urgency {
  const fu = input.nextFollowUpAt ? new Date(input.nextFollowUpAt).getTime() : null
  if (fu != null && !Number.isNaN(fu) && fu <= nowMs) {
    return fu < startOfBusinessDay(nowMs)
      ? { label: 'באיחור', tone: 'text-error-text' }
      : { label: 'להיום', tone: 'text-warning-text' }
  }
  if (input.status === 'new') return { label: 'חדש', tone: 'text-primary-text' }
  return { label: 'ממתין', tone: 'text-gray-400' }
}
