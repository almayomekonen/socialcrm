import type { AutomationCardData } from './AutomationCard'

/**
 * Everything the אוטומציות page DERIVES from the rows it was given.
 *
 * Pure functions over data already in memory — no fetching, no state, no
 * effects. They live outside the component for the reason architecture-rules §3
 * gives: a UI file renders decisions, it does not make them.
 */

/**
 * The filter shape, kept whole even though the workspace now drives only `q`.
 *
 * It moved here from the toolbar that used to render the other three. The shape
 * survives the toolbar because it is the CONTRACT `applyFilters` is tested
 * against, and because status/channel/trigger remain meaningful the moment
 * something wants to filter by them again.
 */
export type Filters = { q: string; status: string; channel: string; trigger: string }

export const NO_FILTERS: Filters = { q: '', status: 'all', channel: 'all', trigger: 'all' }

/** Instant filtering: one pass over data already loaded, never a refetch. */
export function applyFilters(automations: AutomationCardData[], filters: Filters) {
  const q = filters.q.trim().toLowerCase()
  return automations.filter((a) => {
    if (q && !a.name.toLowerCase().includes(q)) return false
    if (filters.status === 'attention') {
      if (!(a.counts.failed > 0 || a.connectionProblem === true)) return false
    } else if (filters.status !== 'all' && a.status !== filters.status) return false
    if (filters.channel !== 'all' && a.actionKey !== filters.channel) return false
    if (filters.trigger !== 'all' && a.eventKey !== filters.trigger) return false
    return true
  })
}
