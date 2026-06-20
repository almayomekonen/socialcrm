'use client'

import type { LeadNextStep } from '@/lib/ai/prompts/leadNextStep'
import { useProgressiveReveal } from '@/lib/copilot/hooks/useProgressiveReveal'
import { URGENCY_LABEL, CONFIDENCE_LABEL } from './labels'

export function NextStepBody({ data, staticRender }: { data: LeadNextStep; staticRender?: boolean }) {
  const { revealed, isRevealing } = useProgressiveReveal(data.recommendation, staticRender)
  const meta = [URGENCY_LABEL[data.urgency], CONFIDENCE_LABEL[data.confidence]].join(' · ')
  const reveal = staticRender ? {} : { 'data-cp-reveal': '' }

  return (
    <div {...reveal} className='pt-1'>
      <p
        className='text-sm leading-relaxed text-gray-900 mb-1.5'
        aria-live={staticRender ? undefined : 'polite'}
      >
        {revealed}
        {isRevealing && <span className='cp-cursor' aria-hidden='true' />}
      </p>

      <p
        className='text-xs text-gray-400 mb-2'
        style={{ opacity: isRevealing ? 0 : 1, transition: 'opacity 200ms ease-out' }}
      >
        {meta}
      </p>

      <p
        className='text-xs text-gray-500 leading-relaxed mb-2'
        style={{ opacity: isRevealing ? 0 : 1, transition: 'opacity 200ms ease-out 60ms' }}
      >
        {data.rationale}
      </p>

      {data.sources.length > 0 && (
        <p
          className='text-xs text-gray-400 tracking-wide'
          style={{ opacity: isRevealing ? 0 : 1, transition: 'opacity 200ms ease-out 120ms' }}
        >
          מבוסס על {data.sources.join(' · ')}
        </p>
      )}
    </div>
  )
}
