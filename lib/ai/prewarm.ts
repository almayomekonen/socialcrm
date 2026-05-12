import { isAiEnabled, hasAnyProviderConfigured } from './flags'
import { getLeadIntelligence } from '@/actions/ai/leadIntelligence'

const COOLDOWN_MS = 5 * 60 * 1000

const lastWarmedAt = new Map<number, number>()

const inFlight = new Map<number, Promise<void>>()

export type PrewarmReason = 'lead.update' | 'lead.upsert' | 'lead.transfer' | 'task.create' | 'task.update' | 'task.delete'

type PrewarmOptions = { reason: PrewarmReason }

function logSkip(leadId: number, reason: string, opts: PrewarmOptions) {
  console.info(`[ai] prewarm.skip leadId=${leadId} reason=${reason} trigger=${opts.reason}`)
}

export function prewarmLeadIntelligence(leadId: number, opts: PrewarmOptions): Promise<void> {
  if (!Number.isFinite(leadId) || leadId <= 0) {
    logSkip(leadId, 'invalid-lead', opts)
    return Promise.resolve()
  }

  if (!isAiEnabled()) {
    logSkip(leadId, 'disabled', opts)
    return Promise.resolve()
  }

  if (!hasAnyProviderConfigured()) {
    logSkip(leadId, 'no-providers', opts)
    return Promise.resolve()
  }

  const last = lastWarmedAt.get(leadId) ?? 0
  if (Date.now() - last < COOLDOWN_MS) {
    logSkip(leadId, 'cooldown', opts)
    return Promise.resolve()
  }

  const existing = inFlight.get(leadId)
  if (existing) {
    logSkip(leadId, 'inflight', opts)
    return existing
  }

  const startedAt = Date.now()
  console.info(`[ai] prewarm.start leadId=${leadId} trigger=${opts.reason}`)

  const promise = (async () => {
    try {
      const res = await getLeadIntelligence(leadId)
      const latencyMs = Date.now() - startedAt
      if (res.ok === true) {
        lastWarmedAt.set(leadId, Date.now())
        console.info(`[ai] prewarm.ok leadId=${leadId} trigger=${opts.reason} latencyMs=${latencyMs}`)
      } else {
        console.warn(`[ai] prewarm.fail leadId=${leadId} trigger=${opts.reason} reason=${res.reason} latencyMs=${latencyMs}`)
      }
    } catch (err) {
      const latencyMs = Date.now() - startedAt
      const message = (err as Error)?.message ?? 'unknown'
      console.warn(`[ai] prewarm.fail leadId=${leadId} trigger=${opts.reason} reason=throw msg=${message} latencyMs=${latencyMs}`)
    } finally {
      inFlight.delete(leadId)
    }
  })()

  inFlight.set(leadId, promise)
  return promise
}

export function _resetPrewarmStateForTests(): void {
  lastWarmedAt.clear()
  inFlight.clear()
}
