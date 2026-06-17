import { requireAgencyUser } from '@/lib/requireUser'
import { getOperatorTakeData } from '@/db/conversationIntelligence'
import { selectRenderableTake, isHoldout } from '@/lib/inbox/intelligence/operatorTake'
import OperatorTakeClient from './OperatorTakeClient'

/**
 * Pinned decision-first take above one conversation. Renders nothing when there
 * is no non-obvious, grounded move (Law 4 silence). The judgment is deterministic
 * (selectRenderableTake); only the wording came from the language layer at analysis time.
 */
export default async function OperatorTake({ conversationId }: { conversationId: number }) {
  const user = await requireAgencyUser().catch(() => null)
  if (!user?.agencyId) return null

  const row = await getOperatorTakeData(user.agencyId, conversationId).catch(() => null)
  const take = selectRenderableTake(conversationId, row)
  if (!take) return null // nothing to say → silence

  const arm = isHoldout(conversationId) ? 'holdout' : 'shown'

  return (
    <OperatorTakeClient
      takeId={take.takeId}
      arm={arm}
      actionMessage={take.actionMessage}
      reason={take.reason}
      sourceMessageIds={take.sourceMessageIds}
      stale={take.stale}
      eventProps={{
        conversationId,
        sourceCount: take.sourceMessageIds.length,
        stale: take.stale,
        promptVersion: row?.promptVersion ?? null,
      }}
    />
  )
}
