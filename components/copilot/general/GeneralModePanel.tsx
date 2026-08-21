'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { useCopilot } from '@/lib/copilot/useCopilot'
import type { CopilotModeId } from '@/lib/ai/copilotModes'
import { recordGeneralModeEvent } from '@/actions/analytics/recordGeneralModeEvent'
import { getDailyBriefing } from '@/actions/ai/getDailyBriefing'
import { askGeneralQuestion, getLeadCardById, type GeneralAnswer } from '@/actions/ai/askGeneralQuestion'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { toConversationState, type ConversationState } from '@/lib/copilot/general/conversationState'
import type { BriefingResult } from '@/lib/copilot/general/types'
import ActiveGenerationRow from '../ActiveGenerationRow'
import GeneralEmptyState from './GeneralEmptyState'
import BriefingCards from './BriefingCards'
import AnswerView from './AnswerView'
import GeneralComposer from './GeneralComposer'
import SuggestionChips, { briefingSuggestions } from './SuggestionChips'

type Turn = { role: 'user'; text: string } | { role: 'assistant'; answer: GeneralAnswer }

// Honest loading timings. Sub-DELAY answers never show a loader (no flash). Once
// shown it holds for MIN (no strobe). The pulse escalates to step text only after
// ESCALATE — a threshold no deterministic path reaches, so text is always honest.
const LOADER_DELAY_MS = 150
const LOADER_MIN_MS = 350
const LOADER_ESCALATE_MS = 1500

export default function GeneralModePanel() {
  /** No paid AI request may be attempted while the subscription is lapsed. */
  const expired = useAccessDenied()
  const { closePanel } = useCopilot()
  const startedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // P0-1: `asking` (below) is the SINGLE source of truth for "busy" — it drives the
  // composer and is the only busy state. `inFlightRef` is not a second busy state: it is
  // `asking`'s synchronous mirror, set/cleared in lockstep, so a same-tick double-fire
  // (before React paints the new `asking`) is still blocked. They cannot diverge.
  const inFlightRef = useRef(false)
  const lastStateRef = useRef<ConversationState | null>(null)
  const [briefing, setBriefing] = useState<BriefingResult | null>(null)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [asking, setAsking] = useState(false)
  // Delayed/min-held loader visibility — distinct from `asking` (which drives the
  // composer busy state immediately). `loaderEscalates` = the path may be expensive.
  const [showLoader, setShowLoader] = useState(false)
  const [loaderEscalates, setLoaderEscalates] = useState(false)
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

  // Show the loader only if the work outlives DELAY; once shown, hold it MIN so it
  // never strobes. The awaited value resolves only after the min hold, smoothing the
  // hand-off to the answer.
  async function withLoader<T>(escalates: boolean, run: () => Promise<T>): Promise<T> {
    let shown = false
    let shownAt = 0
    const showTimer = setTimeout(() => {
      shown = true
      shownAt = Date.now()
      setLoaderEscalates(escalates)
      setShowLoader(true)
    }, LOADER_DELAY_MS)
    try {
      return await run()
    } finally {
      clearTimeout(showTimer)
      if (shown) {
        const remaining = LOADER_MIN_MS - (Date.now() - shownAt)
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
      }
      setShowLoader(false)
    }
  }

  async function ask(text: string, mode?: CopilotModeId) {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const conversationState = lastStateRef.current
    setTranscript((t) => [...t, { role: 'user', text }])
    setAsking(true)
    try {
      const answer = await withLoader(true, () => askGeneralQuestion(text, mode, subject?.id, conversationState))
      lastStateRef.current = toConversationState(answer, conversationState)
      adopt(answer)
      setTranscript((t) => [...t, { role: 'assistant', answer }])
    } finally {
      setAsking(false)
      inFlightRef.current = false
    }
  }

  // Disambiguation selection → resolve the chosen lead INLINE (no navigation) and
  // make it the active subject.
  async function pickLead(leadId: number, label: string) {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setTranscript((t) => [...t, { role: 'user', text: label }])
    setAsking(true)
    try {
      const answer = await withLoader(false, () => getLeadCardById(leadId))
      lastStateRef.current = toConversationState(answer, lastStateRef.current)
      adopt(answer)
      setTranscript((t) => [...t, { role: 'assistant', answer }])
    } finally {
      setAsking(false)
      inFlightRef.current = false
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

  // P0-2: only the latest assistant turn stays interactive; older chips/picks freeze.
  let lastAssistantIndex = -1
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === 'assistant') {
      lastAssistantIndex = i
      break
    }
  }

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
                  <p key={i} className='text-sm text-gray-800'>
                    <span className='font-medium text-gray-500'>אתה: </span>
                    {turn.text}
                  </p>
                ) : (
                  <div key={i} className='gm-answer-enter'>
                    <AnswerView
                      interactive={i === lastAssistantIndex}
                      answer={turn.answer}
                      onPick={(t) => ask(t)}
                      onPickLead={(id, label) => pickLead(id, label)}
                    />
                  </div>
                ),
              )}
              {showLoader && (
                <ActiveGenerationRow
                  fallbackLabel='מגבש תשובה'
                  hint='general-mode'
                  startPhase='pulse'
                  escalateAfterMs={loaderEscalates ? LOADER_ESCALATE_MS : undefined}
                />
              )}
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
          {/*
            The audit found this panel failing SILENTLY: the message appended and
            then nothing — no reply, no error, no spinner. The composer is
            replaced by the locked state so the customer is told why, and the
            paid AI call is never made. No blurred or sample output is shown:
            fabricating a result to look premium would imply a request ran.
          */}
          {expired ? (
            <SubscriptionExpiredState mode='panel' source='ai_panel' feature='העוזר החכם מושהה.' />
          ) : (
            <GeneralComposer onSubmit={(t, mode) => ask(t, mode)} busy={asking} />
          )}
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
        <span className='text-xs font-medium text-gray-700'>עוזר חכם</span>
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
