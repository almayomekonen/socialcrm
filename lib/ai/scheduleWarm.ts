import { after } from 'next/server'
import { isAiEnabled } from './flags'
import { prewarmLeadIntelligence, type PrewarmReason } from './prewarm'

export function scheduleLeadIntelWarm(leadId: number | string | null | undefined, opts: { reason: PrewarmReason }): void {
  if (!isAiEnabled()) return

  const id = Number(leadId)
  if (!Number.isFinite(id) || id <= 0) return

  try {
    after(() => {
      void prewarmLeadIntelligence(id, opts).catch(() => {})
    })
  } catch (err) {
    void Promise.resolve().then(() => prewarmLeadIntelligence(id, opts).catch(() => {}))
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ai] scheduleWarm.fallback', (err as Error)?.message)
    }
  }
}
