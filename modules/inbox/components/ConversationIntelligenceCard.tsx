import { unstable_cache } from 'next/cache'
import { Brain, Lightbulb } from 'lucide-react'
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
import { actionLabel as actionLabelFor, confidenceLabel, intentLabel as intentLabelFor, temperatureBadge as temperatureBadgeFor } from '@/modules/inbox/intelLabels'
import { untranslatedAttrs, type UiLocale } from '@/lib/i18n/config'
import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import { formatLeadDateTime } from '@/lib/leads/leadDate'

/**
 * Conversation Intelligence panel (Phase 3): summary + intent + temperature +
 * recommended next action, produced by one composite worker-side AI call.
 * Reads only persisted data via a tagged cache — rendering NEVER calls AI; the
 * worker's revalidateTag busts the cache after each run. The action is a
 * recommendation for the rep — nothing here executes anything.
 *
 * States: pending (job queued, no result yet) / fresh / stale (newer messages
 * arrived, refresh queued) / failed (analysis dead-lettered).
 *
 * Chrome follows `locale` (the page's; Hebrew by default). The summary and the
 * action's reason are AI-written Hebrew (decision D3) and re-declare Hebrew.
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
  locale = 'he',
}: {
  agencyId: number
  conversationId: number
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const ai = untranslatedAttrs(locale)
  const view = await readIntelligence(agencyId, conversationId)
  const { state, item } = deriveState(view)

  if (state === 'none') return null

  const summary = extractField(item?.data, 'summary')
  const intent = extractField(view.items.find((i) => i.kind === INTEL_KIND_INTENT)?.data, 'intent')
  const temperature = extractField(view.items.find((i) => i.kind === INTEL_KIND_TEMPERATURE)?.data, 'temperature')
  const actionItem = view.items.find((i) => i.kind === INTEL_KIND_ACTION) ?? null
  const action = extractField(actionItem?.data, 'suggestedAction')
  const actionReason = extractField(actionItem?.data, 'reason')

  const intentLabel = intentLabelFor(intent, locale)
  const temperatureBadge = temperatureBadgeFor(temperature, locale)
  // 'none' has no label → the action block is hidden when there is nothing useful to do.
  const actionLabel = actionLabelFor(action, locale)
  const actionConfidenceLabel = confidenceLabel(actionItem?.confidence, locale)

  return (
    <div className='mb-4 rounded-lg border border-gray-200 bg-white p-5'>
      <div className='mb-3 flex items-center justify-between'>
        <p className='flex items-center gap-1.5 text-xs font-semibold text-gray-500'>
          <Brain aria-hidden className='size-3.5 text-accent' />
          {t('inbox.analysis.title')}
        </p>
        <StatePill state={state} t={t} />
      </div>

      {state === 'pending' && <p className='text-sm text-gray-500'>{t('inbox.analysis.pending')}</p>}

      {state === 'failed' && <p className='text-sm text-gray-500'>{t('inbox.analysis.failed')}</p>}

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
            <p className='text-sm leading-relaxed text-gray-800' {...ai}>
              {summary}
            </p>
          ) : (
            <p className='text-sm text-gray-500'>{t('inbox.analysis.noSummary')}</p>
          )}

          {actionLabel && (
            <div className='rounded-md bg-gray-50 p-2.5'>
              <div className='flex items-center justify-between gap-2'>
                <p className='flex items-center gap-1.5 text-xs font-semibold text-gray-700'>
                  <Lightbulb aria-hidden className='size-3.5 shrink-0 text-accent' />
                  {t('inbox.analysis.nextAction', { action: actionLabel })}
                </p>
                {actionConfidenceLabel && (
                  <span className='shrink-0 text-[10px] text-gray-400'>{actionConfidenceLabel}</span>
                )}
              </div>
              {actionReason && (
                <p className='mt-1 text-xs leading-relaxed text-gray-500' {...ai}>
                  {actionReason}
                </p>
              )}
            </div>
          )}

          <p className='text-[10px] tracking-wide text-gray-400'>
            {state === 'stale' ? `${t('inbox.analysis.staleNote')} · ` : ''}
            {item.updatedAt ? t('inbox.analysis.analyzedAt', { date: formatLeadDateTime(locale, item.updatedAt) }) : ''}
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

const STATE_PILL: Record<Exclude<DisplayState, 'none'>, { label: MessageKey; cls: string }> = {
  fresh: { label: 'inbox.analysis.state.fresh', cls: 'bg-green-100 text-green-700' },
  stale: { label: 'inbox.analysis.state.stale', cls: 'bg-amber-100 text-amber-700' },
  failed: { label: 'inbox.analysis.state.failed', cls: 'bg-red-100 text-red-700' },
  pending: { label: 'inbox.analysis.state.pending', cls: 'bg-gray-100 text-gray-600' },
}

function StatePill({ state, t }: { state: DisplayState; t: Translator }) {
  if (state === 'none') return null
  const { label, cls } = STATE_PILL[state]
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{t(label)}</span>
}
