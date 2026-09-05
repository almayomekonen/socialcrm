import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { getLeadsByName } from '@/db/briefing'
import { readerScope } from './readerScope'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import { entityRef } from '../evidence'
import type { EvidenceCollector } from '../evidence'

/**
 * Tool 4 — find a lead by name.
 *
 * WHY THIS EXISTS. Every other lead tool is keyed by `leadId`, and the only
 * source of ids was `get_today_state` — today's queue. A lead outside it was
 * unreachable, however hard the model tried: production ran a three-step
 * investigation for "מי זה Sali?", collected 40 evidence items, and still had to
 * refuse, while Sali sat in the database as lead 1527 of 56. The loop was never
 * the bottleneck; the reachability graph was. This is its missing entry point.
 *
 * AUTHORIZATION IS INHERITED, NOT RE-IMPLEMENTED. `getLeadsByName` is the same
 * gate `get_lead` already trusts, through the same `scopedLeads` builder: it
 * resolves the agency ITSELF from the session via `getAgencyId()`, applies
 * `gotPermIds` for non-admins, the free-plan `overQuota` filter and `lead = true`.
 * So the agency is not merely absent from the model's reach — it is absent from
 * this tool's reach too. Nothing here can widen it.
 *
 * WON DEALS ARE NOT FOUND, exactly as in `get_lead`: Close Deal sets
 * `lead = false` and `scopedLeads` filters `lead = true`. That is the CRM's
 * existing visibility rule, reported rather than worked around.
 *
 * AMBIGUITY IS RETURNED, NOT RESOLVED. Zero, one or many matches all come back as
 * they are. Choosing between two people with the same name is the rep's call, and
 * a tool that guessed would let the Agent confidently discuss the wrong customer.
 *
 * The projection is the four fields needed to identify and triage a lead. No
 * phone, no email, no demographics — the same stance `get_lead` takes.
 */

/** The reader caps its own result set; this mirrors it for the model's benefit. */
const MATCH_LIMIT = 10

export function makeFindLead(deps: { scope: AgentScope; evidence: EvidenceCollector; budget: Budget }) {
  return tool({
    description:
      'Find leads by person name when you do NOT already have a leadId. Use this FIRST whenever the question names a person — "who is Sali", "what happened with David" — and then pass the returned leadId to get_lead or get_conversation. It searches every lead the rep may see, not just today\'s queue. It may return zero, one, or several matches: if several, present the candidates and let the rep choose rather than picking one. Never invent or guess a leadId.',
    inputSchema: z.object({
      name: z.string().min(1).describe('The person name, or part of it, exactly as the rep said it. Never an id.'),
    }),
    execute: async ({ name }) => {
      const query = (name ?? '').trim()
      const verdict = deps.budget.canStep('find_lead', query.toLowerCase())
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      // A blank query would match everything the reader can see; refuse it here
      // rather than hand back the rep's whole book as "matches".
      if (!query) {
        deps.budget.noteResult('find_lead:empty')
        return { matches: [], total: 0 }
      }

      // The gate. The permission scope comes from the server-resolved AgentScope;
      // the agency comes from the session, inside the reader.
      const found = await getLeadsByName(readerScope(deps.scope), query)

      const matches = found.slice(0, MATCH_LIMIT).map((l) => ({
        leadId: l.id,
        /** Cite THIS string. See `entityRef` — the format is given, not inferred. */
        evidenceRef: entityRef('lead', l.id),
        name: l.name,
        status: l.status,
        nextFollowUpAt: l.nextFollowUpAt,
      }))

      // Every returned lead is citable; a match the Agent cannot cite is a match
      // it cannot mention.
      for (const m of matches) deps.evidence.add({ kind: 'lead', refId: String(m.leadId) })

      const payload = { matches, total: matches.length }
      deps.budget.noteResult(JSON.stringify(payload))
      return payload
    },
  })
}
