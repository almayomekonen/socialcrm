// Time-of-day greeting bucket, computed SERVER-SIDE in the business timezone.
// Kept deterministic and off the client so server-rendered HTML and hydration
// always agree (no client Date(), no hydration mismatch — see dashboard spec §9).

const BUSINESS_TZ = 'Asia/Jerusalem'

/** 'בוקר טוב' (05–11) · 'צהריים טובים' (12–16) · 'ערב טוב' (otherwise). */
export function greetingBucket(now: Date, tz: string = BUSINESS_TZ): string {
  const hourStr = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(now)
  const hour = Number.parseInt(hourStr, 10)
  if (hour >= 5 && hour <= 11) return 'בוקר טוב'
  if (hour >= 12 && hour <= 16) return 'צהריים טובים'
  return 'ערב טוב'
}
