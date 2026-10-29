import { AlertCircle, Lightbulb, Sparkles } from 'lucide-react'
import { requireAgencyUser } from '@/lib/requireUser'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { getLeadIntelligence } from '@/actions/ai/leadIntelligence'
import LeadIntelligenceTeaser from './LeadIntelligenceTeaser'
import RefreshLeadIntelligenceButton from './RefreshLeadIntelligenceButton'
import { dirFor, regionAttrs, untranslatedAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey, Translator } from '@/lib/i18n/translate'

type Props = {
  leadId: number | string
  /**
   * Interface language of the card's CHROME, resolved once by the page. The
   * inbox and the mobile lead detail pass nothing and stay Hebrew. The AI's own
   * text is never translated (decision D3): it is Hebrew, so its blocks
   * re-declare Hebrew inside a translated card.
   */
  locale?: UiLocale
}

/** The fixed `SourceCategory` values the model picks from, labelled by value. Anything else is shown as it came. */
const SOURCE_KEY: Record<string, MessageKey> = {
  'סטטוס הליד': 'leadDetail.intelligence.source.status',
  'פעילות אחרונה': 'leadDetail.intelligence.source.activity',
  'היסטוריית המשימות': 'leadDetail.intelligence.source.tasks',
  'פרטי הליד': 'leadDetail.intelligence.source.details',
  'מקור הליד': 'leadDetail.intelligence.source.origin',
  'הטיפול בליד': 'leadDetail.intelligence.source.handling',
}

function sourceLabel(t: Translator, value: string): string {
  const key = SOURCE_KEY[value]
  return key ? t(key) : value
}

/** The recommended-action rule sits on the reading start: right in RTL (the legacy classes), left in LTR. */
const ACTION_RULE = { rtl: 'border-r-2 border-info-border pr-3', ltr: 'border-l-2 border-info-border pl-3' } as const

const MIN_HEIGHT = 200

const STAGGER_STYLE = `
  [data-li-reveal] > * {
    opacity: 0;
    animation: li-fade-in 280ms ease-out forwards;
  }
  [data-li-reveal] > *:nth-child(1) { animation-delay: 0ms; }
  [data-li-reveal] > *:nth-child(2) { animation-delay: 120ms; }
  [data-li-reveal] > *:nth-child(3) { animation-delay: 240ms; }
  [data-li-reveal] > *:nth-child(4) { animation-delay: 360ms; }
  @keyframes li-fade-in {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-li-reveal] > * { animation: none; opacity: 1; }
  }
`

export default async function LeadIntelligenceCard({ leadId, locale = 'he' }: Props) {
  const t = translatorFor(locale)
  const region = regionAttrs(locale)
  const aiText = untranslatedAttrs(locale)
  /**
   * ENTITLEMENT IS RESOLVED BEFORE THE AI PATH IS ENTERED, ON PURPOSE.
   *
   * `getLeadIntelligence` would refuse a lapsed subscription safely on its own —
   * `runStructured` calls `resolveAiAccess` before a provider is chosen — but it
   * still walks the cached-action dispatcher, reads the lead snapshot and takes
   * a cache slot to arrive at a refusal we can already predict. Asking the
   * canonical resolver first means an expired customer's page does none of that
   * work, and there is no route from this component to a provider at all.
   *
   * Both helpers are React `cache()`d and already called by this page's layout,
   * so this costs no additional query.
   *
   * The teaser that follows is local and deterministic: no AI call, no tokens,
   * no cached summary, nothing derived from the lead.
   */
  const user = await requireAgencyUser()
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return <LeadIntelligenceTeaser locale={locale} />
  }

  const res = await getLeadIntelligence(leadId)

  if (res.ok === false) {
    if (res.reason === 'disabled' || res.reason === 'forbidden') return null

    /**
     * BACKSTOP. The entitlement check above already returned the teaser for a
     * lapsed subscription, so this branch is reached only if the canonical
     * resolver and the AI router disagree (a fail-open read, or a plan that
     * changed mid-render). It answers with the same teaser rather than the
     * generic retry line, which told a lapsed customer to try again once a
     * minute for something only payment can clear.
     *
     * Reaching it costs no AI either: `runStructured` resolves product access
     * through the SAME `getAgencyProductAccess` (lib/ai/access.ts) and returns a
     * typed business reason before a provider is chosen.
     *
     * ONE PERSISTENT NOTICE PER SCREEN still holds: the teaser describes the
     * capability and raises the subscription only on interaction.
     */
    if (res.reason === 'subscription-required' || res.reason === 'trial-not-started') {
      return <LeadIntelligenceTeaser locale={locale} />
    }

    return (
      <div className='rounded-lg border border-gray-200 bg-white p-5 mb-8' style={{ minHeight: MIN_HEIGHT }} {...region}>
        <div className='flex items-center justify-between mb-2'>
          <p className='flex items-center gap-1.5 text-xs font-semibold text-gray-500'>
            <Sparkles aria-hidden className='size-3.5 text-accent' />
            {t('leadDetail.intelligence.title')}
          </p>
          <RefreshLeadIntelligenceButton leadId={leadId} locale={locale} />
        </div>
        <p className='flex items-center gap-1.5 text-sm text-gray-500'>
          <AlertCircle aria-hidden className='size-4 shrink-0 text-gray-400' />
          {t('leadDetail.intelligence.unavailable')}
        </p>
      </div>
    )
  }

  const { summary, keyInsights, suggestedNextAction, sources, confidence } = res.data

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-5 mb-8' style={{ minHeight: MIN_HEIGHT }} {...region}>
      <style>{STAGGER_STYLE}</style>

      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <p className='flex items-center gap-1.5 text-xs font-semibold text-gray-500'>
            <Sparkles aria-hidden className='size-3.5 text-accent' />
            {t('leadDetail.intelligence.title')}
          </p>
          <ConfidencePill confidence={confidence} t={t} />
        </div>
        <RefreshLeadIntelligenceButton leadId={leadId} locale={locale} />
      </div>

      <div data-li-reveal className='space-y-4'>
        <p className='text-sm leading-relaxed text-gray-900' {...aiText}>
          {summary}
        </p>

        {keyInsights.length > 0 ? (
          <ul className='text-sm leading-relaxed text-gray-700 space-y-1.5 list-disc pr-5' {...aiText}>
            {keyInsights.map((insight, i) => (
              <li key={i}>{insight}</li>
            ))}
          </ul>
        ) : (
          <div />
        )}

        <div className={ACTION_RULE[dirFor(locale)]}>
          <p className='flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-1'>
            <Lightbulb aria-hidden className='size-3.5 text-accent' />
            {t('leadDetail.intelligence.nextAction')}
          </p>
          <p className='text-sm font-medium text-gray-900' {...aiText}>
            {suggestedNextAction.title}
          </p>
          <p className='text-xs text-gray-500 mt-0.5 leading-relaxed' {...aiText}>
            {suggestedNextAction.reason}
          </p>
        </div>

        {sources.length > 0 ? (
          <p className='text-[10px] text-gray-400 tracking-wide'>
            {t('leadDetail.intelligence.basedOn', { sources: sources.map((v) => sourceLabel(t, v)).join(' · ') })}
          </p>
        ) : (
          <div />
        )}
      </div>
    </div>
  )
}

function ConfidencePill({ confidence, t }: { confidence: 'low' | 'medium' | 'high'; t: Translator }) {
  const label =
    confidence === 'high'
      ? t('leadDetail.intelligence.confidence.high')
      : confidence === 'medium'
        ? t('leadDetail.intelligence.confidence.medium')
        : t('leadDetail.intelligence.confidence.low')
  return (
    <span className='px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-600'>{label}</span>
  )
}
