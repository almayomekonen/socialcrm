import { unstable_cache } from 'next/cache'
import {
  INTEL_KIND_ACTION,
  INTEL_KIND_INTENT,
  INTEL_KIND_SUMMARY,
  INTEL_KIND_TEMPERATURE,
  conversationIntelligenceTag,
  getConversationIntelligence,
  type ConversationIntelligenceItem,
  type ConversationIntelligenceView,
} from '@/db/conversationIntelligence'
import { formatDateTime } from '@/lib/dates'
import { ACTION_LABELS, CONFIDENCE_LABELS, INTENT_LABELS, TEMPERATURE_BADGES } from '@/modules/inbox/intelLabels'

/**
 * Conversation Intelligence panel (Phase 3): summary + intent + temperature +
 * recommended next action, produced by one composite worker-side AI call.
 * Reads only persisted data via a tagged cache — rendering NEVER calls AI; the
 * worker's revalidateTag busts the cache after each run. The action is a
 * recommendation for the rep — nothing here executes anything.
 *
 * States: pending (job queued, no result yet) / fresh / stale (newer messages
 * arrived, refresh queued) / failed (analysis dead-lettered).
 */

type DisplayState = 'pending' | 'fresh' | 'stale' | 'failed' | 'none'

const readIntelligence = (agencyId: number, conversationId: number): Promise<ConversationIntelligenceView> =>
  unstable_cache(
    () => getConversationIntelligence(agencyId, conversationId),
    ['conv-intel', String(agencyId), String(conversationId)],
    { tags: [conversationIntelligenceTag(conversationId)], revalidate: 30 },
  )()

function deriveState(view: ConversationIntelligenceView): { state: DisplayState; item: ConversationIntelligenceItem | null } {
  // The summary row is the representative: all kinds are written atomically.
  const item = view.items.find((i) => i.kind === INTEL_KIND_SUMMARY) ?? null
  if (item?.status === 'failed') return { state: 'failed', item }
  if (item?.status === 'stale') return { state: 'stale', item }
  if (item?.status === 'fresh') return { state: 'fresh', item }
  if (view.jobPending) return { state: 'pending', item: null }
  return { state: 'none', item: null }
}

export default async function ConversationIntelligenceCard({
  agencyId,
  conversationId,
}: {
  agencyId: number
  conversationId: number
}) {
  const view = await readIntelligence(agencyId, conversationId)
  const { state, item } = deriveState(view)

  if (state === 'none') return null

  const summary = extractField(item?.data, 'summary')
  const intent = extractField(view.items.find((i) => i.kind === INTEL_KIND_INTENT)?.data, 'intent')
  const temperature = extractField(view.items.find((i) => i.kind === INTEL_KIND_TEMPERATURE)?.data, 'temperature')
  const actionItem = view.items.find((i) => i.kind === INTEL_KIND_ACTION) ?? null
  const action = extractField(actionItem?.data, 'suggestedAction')
  const actionReason = extractField(actionItem?.data, 'reason')

  const intentLabel = intent ? INTENT_LABELS[intent] : null
  const temperatureBadge = temperature ? TEMPERATURE_BADGES[temperature] : null
  // 'none' has no label → the action block is hidden when there is nothing useful to do.
  const actionLabel = action ? ACTION_LABELS[action] : null
  const actionConfidenceLabel = actionItem?.confidence ? CONFIDENCE_LABELS[actionItem.confidence] : null

  return (
    <div className='mb-4 rounded-lg border border-gray-200 bg-white p-5'>
      <div className='mb-3 flex items-center justify-between'>
        <p className='text-xs font-semibold text-gray-500'>ניתוח שיחה</p>
        <StatePill state={state} />
      </div>

      {state === 'pending' && <p className='text-sm text-gray-500'>מנתח את השיחה…</p>}

      {state === 'failed' && (
        <p className='text-sm text-gray-500'>ניתוח השיחה נכשל. ננסה שוב אוטומטית כשתתקבל הודעה חדשה.</p>
      )}

      {(state === 'fresh' || state === 'stale') && item && (
        <div className='space-y-3'>
          {(temperatureBadge || intentLabel) && (
            <div className='flex flex-wrap gap-1.5'>
              {temperatureBadge && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${temperatureBadge.cls}`}>
                  {temperatureBadge.label}
                </span>
              )}
              {intentLabel && (
                <span className='rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700'>
                  {intentLabel}
                </span>
              )}
            </div>
          )}

          {summary ? (
            <p className='text-sm leading-relaxed text-gray-800'>{summary}</p>
          ) : (
            <p className='text-sm text-gray-500'>אין סיכום זמין.</p>
          )}

          {actionLabel && (
            <div className='rounded-md bg-gray-50 p-2.5'>
              <div className='flex items-center justify-between gap-2'>
                <p className='text-xs font-semibold text-gray-700'>הצעד הבא המומלץ: {actionLabel}</p>
                {actionConfidenceLabel && (
                  <span className='shrink-0 text-[10px] text-gray-400'>{actionConfidenceLabel}</span>
                )}
              </div>
              {actionReason && <p className='mt-1 text-xs leading-relaxed text-gray-500'>{actionReason}</p>}
            </div>
          )}

          <p className='text-[10px] tracking-wide text-gray-400'>
            {state === 'stale' ? 'הודעות חדשות התקבלו — הניתוח מתעדכן · ' : ''}
            {item.updatedAt ? `נותח לאחרונה ${formatDateTime(item.updatedAt)}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}

function extractField(data: unknown, field: string): string | null {
  const d = (data ?? {}) as Record<string, unknown>
  const v = d[field]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function StatePill({ state }: { state: DisplayState }) {
  const map: Record<Exclude<DisplayState, 'none'>, { label: string; cls: string }> = {
    fresh: { label: 'מעודכן', cls: 'bg-green-100 text-green-700' },
    stale: { label: 'מתעדכן', cls: 'bg-amber-100 text-amber-700' },
    failed: { label: 'נכשל', cls: 'bg-red-100 text-red-700' },
    pending: { label: 'בתהליך', cls: 'bg-gray-100 text-gray-600' },
  }
  if (state === 'none') return null
  const { label, cls } = map[state]
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{label}</span>
}
