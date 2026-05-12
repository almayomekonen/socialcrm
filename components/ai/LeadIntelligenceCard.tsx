import { getLeadIntelligence } from '@/actions/ai/leadIntelligence'
import RefreshLeadIntelligenceButton from './RefreshLeadIntelligenceButton'

type Props = {
  leadId: number | string
}

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

export default async function LeadIntelligenceCard({ leadId }: Props) {
  const res = await getLeadIntelligence(leadId)

  if (res.ok === false) {
    if (res.reason === 'disabled' || res.reason === 'forbidden') return null

    return (
      <div className='rounded-lg border border-gray-200 bg-white p-5 mb-8' style={{ minHeight: MIN_HEIGHT }}>
        <div className='flex items-center justify-between mb-2'>
          <p className='text-xs font-semibold text-gray-500'>תקציר חכם</p>
          <RefreshLeadIntelligenceButton leadId={leadId} />
        </div>
        <p className='text-sm text-gray-500'>העוזר החכם לא זמין כרגע — נסה שוב בעוד דקה.</p>
      </div>
    )
  }

  const { summary, keyInsights, suggestedNextAction, sources, confidence } = res.data

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-5 mb-8' style={{ minHeight: MIN_HEIGHT }}>
      <style>{STAGGER_STYLE}</style>

      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <p className='text-xs font-semibold text-gray-500'>תקציר חכם</p>
          <ConfidencePill confidence={confidence} />
        </div>
        <RefreshLeadIntelligenceButton leadId={leadId} />
      </div>

      <div data-li-reveal className='space-y-4'>
        <p className='text-sm leading-relaxed text-gray-900'>{summary}</p>

        {keyInsights.length > 0 ? (
          <ul className='text-sm leading-relaxed text-gray-700 space-y-1.5 list-disc pr-5'>
            {keyInsights.map((insight, i) => (
              <li key={i}>{insight}</li>
            ))}
          </ul>
        ) : (
          <div />
        )}

        <div className='border-r-2 border-gray-200 pr-3'>
          <p className='text-xs font-semibold text-gray-500 mb-1'>פעולה מומלצת</p>
          <p className='text-sm font-medium text-gray-900'>{suggestedNextAction.title}</p>
          <p className='text-xs text-gray-500 mt-0.5 leading-relaxed'>{suggestedNextAction.reason}</p>
        </div>

        {sources.length > 0 ? (
          <p className='text-[10px] text-gray-400 tracking-wide'>מבוסס על: {sources.join(' · ')}</p>
        ) : (
          <div />
        )}
      </div>
    </div>
  )
}

function ConfidencePill({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const label = confidence === 'high' ? 'ביטחון גבוה' : confidence === 'medium' ? 'ביטחון בינוני' : 'ביטחון נמוך'
  return (
    <span className='px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-600'>{label}</span>
  )
}
