import { getFullLead } from './clients'
import { getLeadFollowUpSignals } from './followUpSignals'
import { followUpPulse } from '@/lib/ai/followUpRules'
import { buildLeadGlanceFacts, buildLeadSuggestedActions } from '@/lib/copilot/leadActions'
import { classifyLeadStatus, type CopilotLeadContext } from '@/lib/copilot/copilotContext'

/**
 * Build the deterministic copilot context payload for a single lead.
 *
 * Hard rules:
 *   - No AI calls. No prompting. No mutations. Reads only.
 *   - All fields must be JSON-serializable for safe RSC → client transfer.
 *   - Tenant isolation is enforced by `getFullLead` (which scopes by
 *     `agencyId` of the requesting user). If the lead doesn't belong to the
 *     user's agency, returns `null`.
 *   - Lightweight by design. Two parallel queries:
 *       a. `getFullLead` — narrow `name` + `status` selection.
 *       b. `getLeadFollowUpSignals` — single CTE for tasks + status timing.
 */
export async function buildCopilotLeadContext(leadIdRaw: number | string): Promise<CopilotLeadContext | null> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return null

  const [lead, signalsMap] = await Promise.all([
    getFullLead({ id: leadId, select: ['name', 'status'] }),
    getLeadFollowUpSignals([leadId]),
  ])

  if (!lead?.name) return null

  const signals = signalsMap.get(leadId) ?? {
    status: lead.status ?? null,
    daysSinceLastInteraction: null,
    daysInCurrentStatus: null,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    openTaskCount: 0,
    taskCompletionRate: null,
  }

  const status = (lead.status as string | null) ?? signals.status ?? null
  const statusTone = classifyLeadStatus(status)
  const pulse = followUpPulse(signals)

  const facts = buildLeadGlanceFacts({ signals, statusTone })
  const suggestedActions = buildLeadSuggestedActions({ statusTone })

  return {
    kind: 'lead',
    leadId,
    leadName: lead.name as string,
    status,
    statusTone,
    pulse,
    facts,
    suggestedActions,
  }
}
