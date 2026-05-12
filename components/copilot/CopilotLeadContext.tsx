import { buildCopilotLeadContext } from '@/db/copilotLeadContext'
import { CopilotContextHydrator } from '@/lib/copilot/copilotContextStore'
import { isCopilotEnabledForUser } from '@/lib/copilot/featureFlag'
import { getUser } from '@/db/auth'

type Props = {
  leadId: number | string
}

/**
 * Server-side context publisher for a lead route.
 *
 * Place inside a `<Suspense fallback={null}>` boundary in the lead layout —
 * its data fetching runs in parallel with the rest of the page and never
 * blocks the user's primary content.
 *
 * Gated by the copilot feature flag: when copilot is disabled for the
 * current user/agency, this short-circuits to `null` BEFORE issuing any DB
 * queries. That keeps the lead page cost identical for non-copilot users.
 *
 * If the lead is not visible to the current user (cross-agency, missing,
 * etc.), this renders nothing and the panel stays in its empty state.
 */
export default async function CopilotLeadContext({ leadId }: Props) {
  const user = await getUser()
  if (!isCopilotEnabledForUser(user)) return null

  const context = await buildCopilotLeadContext(leadId)
  if (!context) return null
  return <CopilotContextHydrator context={context} />
}
