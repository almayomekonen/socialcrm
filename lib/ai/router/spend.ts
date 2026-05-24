// Per-agency daily USD spend tracker. In-memory only — restart resets the
// running totals. The router consults this before each call and aborts with
// 'over-quota' once `getAiEnv().dailyUsdCap` is reached.

type DailyEntry = { dateUtc: string; usd: number }

const dailySpend = new Map<number, DailyEntry>()

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export function getDailySpend(agencyId: number): number {
  const e = dailySpend.get(agencyId)
  if (!e) return 0
  if (e.dateUtc !== todayUtc()) {
    dailySpend.delete(agencyId)
    return 0
  }
  return e.usd
}

export function addDailySpend(agencyId: number, usd: number) {
  const today = todayUtc()
  const e = dailySpend.get(agencyId)
  if (!e || e.dateUtc !== today) dailySpend.set(agencyId, { dateUtc: today, usd })
  else e.usd += usd
}

export function _resetDailySpendForTests() {
  dailySpend.clear()
}
