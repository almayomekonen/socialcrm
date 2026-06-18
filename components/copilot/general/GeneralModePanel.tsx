'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { useCopilot } from '@/lib/copilot/useCopilot'
import type { CopilotModeId } from '@/lib/ai/copilotModes'
import { recordGeneralModeEvent } from '@/actions/analytics/recordGeneralModeEvent'
import { getDailyBriefing } from '@/actions/ai/getDailyBriefing'
import { askGeneralQuestion, getLeadCardById, type GeneralAnswer } from '@/actions/ai/askGeneralQuestion'
import type { BriefingResult } from '@/lib/copilot/general/types'
import ActiveGenerationRow from '../ActiveGenerationRow'
import GeneralEmptyState from './GeneralEmptyState'
import BriefingCards from './BriefingCards'
import AnswerView from './AnswerView'
import GeneralComposer from './GeneralComposer'
import SuggestionChips, { briefingSuggestions } from './SuggestionChips'

type Turn = { role: 'user'; text: string } | { role: 'assistant'; answer: GeneralAnswer }

export default function GeneralModePanel() {
  const { closePanel } = useCopilot()
  const startedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [briefing, setBriefing] = useState<BriefingResult | null>(null)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [asking, setAsking] = useState(false)
  // Session-only active lead subject (Step 2). Not persisted, no DB, resets on remount.
  const [subject, setSubject] = useState<{ id: number; name: string } | null>(null)

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

  // A resolved lead card becomes the active subject (set on a new name OR a pick).
  function adopt(answer: GeneralAnswer) {
    if (answer.kind === 'lead') setSubject({ id: answer.lead.id, name: answer.lead.name })
  }

  async function ask(text: string, mode?: CopilotModeId) {
    setTranscript((t) => [...t, { role: 'user', text }])
    setAsking(true)
    try {
      const answer = await askGeneralQuestion(text, mode, subject?.id)
      adopt(answer)
      setTranscript((t) => [...t, { role: 'assistant', answer }])
    } finally {
      setAsking(false)
    }
  }

  // Disambiguation selection → resolve the chosen lead INLINE (no navigation) and
  // make it the active subject.
  async function pickLead(leadId: number, label: string) {
    setTranscript((t) => [...t, { role: 'user', text: label }])
    setAsking(true)
    try {
      const answer = await getLeadCardById(leadId)
      adopt(answer)
      setTranscript((t) => [...t, { role: 'assistant', answer }])
    } finally {
      setAsking(false)
    }
  }

  // Keep the newest message visible — but only when already near the bottom, so
  // we never yank the user while they read scrollback (cf. CopilotTimeline).
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    if (distanceFromBottom < 120) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [transcript.length, asking])

  const isEmptySystem = briefing?.kind === 'empty'

  return (
    <div className='h-full flex flex-col items-stretch'>
      <Header onClose={closePanel} />

      <div ref={scrollRef} className='flex-1 overflow-y-auto px-3'>
        {!briefing && <Centered text='טוען…' />}
        {isEmptySystem && <GeneralEmptyState />}
        {briefing?.kind === 'briefing' &&
          (transcript.length === 0 ? (
            // Pre-question: Daily Briefing + quick-question chips.
            <div className='space-y-2.5 pb-2'>
              <BriefingCards greeting={briefing.greeting} sections={briefing.sections} />
              <div className='space-y-1.5'>
                <p className='text-[12px] text-gray-400'>שאלות מהירות</p>
                <SuggestionChips items={briefingSuggestions()} onPick={(t) => ask(t)} />
              </div>
            </div>
          ) : (
            // Conversation: the briefing is replaced by the running transcript.
            <div className='space-y-2.5 pb-2'>
              {transcript.map((turn, i) =>
                turn.role === 'user' ? (
                  <p key={i} className='text-[13px] text-gray-800'>
                    <span className='font-medium text-gray-500'>אתה: </span>
                    {turn.text}
                  </p>
                ) : (
                  <AnswerView key={i} answer={turn.answer} onPick={(t) => ask(t)} onPickLead={(id, label) => pickLead(id, label)} />
                ),
              )}
              {asking && <ActiveGenerationRow fallbackLabel='מגבש תשובה' hint='general-mode' />}
            </div>
          ))}
      </div>

      {!isEmptySystem && briefing && (
        <div className='w-full px-3 pb-3 pt-3'>
          {subject && (
            <div className='mb-2 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[12px] text-gray-700'>
              <span>מדברים על: {subject.name}</span>
              <button
                type='button'
                onClick={() => setSubject(null)}
                aria-label='נקה נושא'
                className='text-gray-400 hover:text-gray-700'
              >
                ✕
              </button>
            </div>
          )}
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
