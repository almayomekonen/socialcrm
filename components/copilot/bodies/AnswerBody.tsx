'use client'

import { useCallback, useState } from 'react'
import Icon from '@/lib/Icon'
import type { LeadAskAnswer } from '@/lib/ai/prompts/leadAskQuestion'
import { useProgressiveReveal } from '@/lib/copilot/hooks/useProgressiveReveal'
import { CONFIDENCE_LABEL } from './labels'

export function AnswerBody({ data, staticRender }: { data: LeadAskAnswer; staticRender?: boolean }) {
  const [copied, setCopied] = useState(false)
  const { revealed, isRevealing } = useProgressiveReveal(data.answer, staticRender)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(data.answer)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard may be denied — rep can manually select.
    }
  }, [data.answer])

  const reveal = staticRender ? {} : { 'data-cp-reveal': '' }

  return (
    <div {...reveal} className='pt-1'>
      <div
        className='text-sm leading-relaxed text-gray-900 whitespace-pre-wrap wrap-break-word select-text mb-2'
        aria-live={staticRender ? undefined : 'polite'}
      >
        {revealed.split('\n').map((line, i, arr) => (
          <div key={i} dir='auto'>
            {line || ' '}
            {isRevealing && i === arr.length - 1 && <span className='cp-cursor' aria-hidden='true' />}
          </div>
        ))}
      </div>

      <div
        className='flex items-center justify-between gap-2 mb-1.5'
        style={{ opacity: isRevealing ? 0 : 1, transition: 'opacity 200ms ease-out' }}
      >
        <button
          type='button'
          onClick={copy}
          disabled={isRevealing}
          className='inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 transition-colors duration-150'
        >
          <Icon name='copy' type='reg' className='size-3 bg-gray-400' />
          <span>{copied ? 'הועתק' : 'העתק'}</span>
        </button>
        <span className='text-xs text-gray-400 truncate'>{CONFIDENCE_LABEL[data.confidence]}</span>
      </div>

      {data.sources.length > 0 && (
        <p
          className='text-xs text-gray-400 tracking-wide'
          style={{ opacity: isRevealing ? 0 : 1, transition: 'opacity 200ms ease-out 60ms' }}
        >
          מבוסס על {data.sources.join(' · ')}
        </p>
      )}
    </div>
  )
}
