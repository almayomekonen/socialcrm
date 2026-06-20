'use client'

import { useCallback, useState } from 'react'
import Icon from '@/lib/Icon'
import type { LeadFollowup } from '@/lib/ai/prompts/leadFollowup'
import { useProgressiveReveal } from '@/lib/copilot/hooks/useProgressiveReveal'
import { CHANNEL_LABEL, TONE_LABEL, CONFIDENCE_LABEL } from './labels'


export function FollowupBody({ data, staticRender }: { data: LeadFollowup; staticRender?: boolean }) {
  const [copied, setCopied] = useState(false)
  const { revealed, isRevealing } = useProgressiveReveal(data.message, staticRender)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(data.message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard may be denied — rep can manually select.
    }
  }, [data.message])

  const meta = [CHANNEL_LABEL[data.channel], TONE_LABEL[data.tone], CONFIDENCE_LABEL[data.confidence]].join(' · ')
  const reveal = staticRender ? {} : { 'data-cp-reveal': '' }

  return (
    <div {...reveal} className='pt-1'>
      <p
        dir='auto'
        className='text-sm leading-relaxed text-gray-900 whitespace-pre-wrap wrap-break-word select-text mb-2'
        aria-live={staticRender ? undefined : 'polite'}
      >
        {revealed}
        {isRevealing && <span className='cp-cursor' aria-hidden='true' />}
      </p>

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
        <span className='text-xs text-gray-400 truncate'>{meta}</span>
      </div>

      <p
        className='text-[11px] text-gray-500 leading-relaxed mb-1'
        style={{ opacity: isRevealing ? 0 : 1, transition: 'opacity 200ms ease-out 60ms' }}
      >
        {data.reason}
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
