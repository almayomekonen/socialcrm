'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { useCopilot } from '@/lib/copilot/useCopilot'
import type { CopilotModeId } from '@/lib/ai/copilotModes'
import { recordGeneralModeEvent } from '@/actions/analytics/recordGeneralModeEvent'
import { getDailyBriefing } from '@/actions/ai/getDailyBriefing'
import { askGeneralQuestion, type GeneralAnswer } from '@/actions/ai/askGeneralQuestion'
import type { BriefingResult } from '@/lib/copilot/general/types'
import ActiveGenerationRow from '../ActiveGenerationRow'
import GeneralEmptyState from './GeneralEmptyState'
import BriefingCards from './BriefingCards'
import AnswerView from './AnswerView'
import GeneralComposer from './GeneralComposer'
import SuggestionChips, { briefingSuggestions } from './SuggestionChips'

export default function GeneralModePanel() {
  const { closePanel } = useCopilot()
  const startedRef = useRef(false)
  const [briefing, setBriefing] = useState<BriefingResult | null>(null)
  const [answer, setAnswer] = useState<GeneralAnswer | null>(null)
  const [asking, setAsking] = useState(false)
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void recordGeneralModeEvent('general_mode.opened')

    let active = true
    getDailyBriefing()
      .then((res) => active && setBriefing(res))
      .catch(() => active && setBriefing({ kind: 'briefing', greeting: '', sections: [] }))
    return () => {
      active = false
    }
  }, [])

  async function ask(text: string, mode?: CopilotModeId) {
    setLastQuestion(text)
    setAnswer(null)
    setAsking(true)
    try {
      setAnswer(await askGeneralQuestion(text, mode))
    } finally {
      setAsking(false)
    }
  }

  const isEmptySystem = briefing?.kind === 'empty'

  return (
    <div className='h-full flex flex-col items-stretch'>
      <Header onClose={closePanel} />

      <div className='flex-1 overflow-y-auto px-3'>
        {!briefing && <Centered text='טוען…' />}
        {isEmptySystem && <GeneralEmptyState />}
        {briefing?.kind === 'briefing' && (
          <div className='space-y-2.5 pb-2'>
            <BriefingCards greeting={briefing.greeting} sections={briefing.sections} />

            {lastQuestion && (asking || answer) && (
              <p className='text-[13px] text-gray-800'>
                <span className='font-medium text-gray-500'>אתה: </span>
                {lastQuestion}
              </p>
            )}

            {asking ? (
              <ActiveGenerationRow fallbackLabel='מגבש תשובה' hint='general-mode' />
            ) : answer ? (
              <AnswerView answer={answer} onPick={(t) => ask(t)} />
            ) : (
              <div className='space-y-1.5'>
                <p className='text-[12px] text-gray-400'>שאלות מהירות</p>
                <SuggestionChips items={briefingSuggestions()} onPick={(t) => ask(t)} />
              </div>
            )}
          </div>
        )}
      </div>

      {!isEmptySystem && briefing && (
        <div className='w-full px-3 pb-3 pt-3'>
          <GeneralComposer onSubmit={(t, mode) => ask(t, mode)} busy={asking} />
        </div>
      )}
    </div>
  )
}

function Centered({ text }: { text: string }) {
  return (
    <div className='h-full flex items-center justify-center select-none'>
      <p className='text-xs text-gray-400'>{text}</p>
    </div>
  )
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className='shrink-0 w-full h-8 flex items-center justify-between px-2'>
      <div className='flex items-center gap-1.5'>
        <Icon name='sparkles' type='reg' className='size-3.5 bg-gray-400' />
        <span className='text-[12.5px] font-medium text-gray-700'>עוזר חכם</span>
      </div>
      <button
        type='button'
        onClick={onClose}
        aria-label='סגור עוזר חכם'
        className='group p-1 rounded-full hover:bg-gray-100 transition-colors duration-150'
      >
        <Icon name='xmark' type='reg' className='size-4 bg-gray-950 group-hover:bg-gray-700 transition-colors' />
      </button>
    </div>
  )
}
