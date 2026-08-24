'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import AgentAnswerView, { AgentErrorView } from './AgentAnswerView'
import { askAgentApi, type AgentAskFailure } from '@/lib/copilot/general/agentClient'
import type { AgentResult } from '@/lib/agent/types'
import GeneralComposer from './GeneralComposer'
import SuggestionChips, { briefingSuggestions } from './SuggestionChips'
import { useLoaderTiming, LOADER_ESCALATE_MS } from './useLoaderTiming'

type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; answer: GeneralAnswer }
  /** One Agent investigation. Carries the whole result; the view decides what is shown. */
  | { role: 'agent'; result: AgentResult }
  /** Transport/authorization failure — never silent, always readable. */
  | { role: 'agentError'; reason: AgentAskFailure }

/**
 * `agentEnabled` is resolved on the SERVER (isAgentEnabled → AGENT_AGENCY_IDS)
 * and threaded down like `generalModeEnabled` before it. It defaults to false,
 * so every agency that is not opted in keeps today's General Mode behaviour
 * unchanged, byte for byte.
 */
export default function GeneralModePanel({ agentEnabled = false }: { agentEnabled?: boolean } = {}) {
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
  const { showLoader, loaderEscalates, withLoader } = useLoaderTiming()
  // Session-only active lead subject (Step 2). Not persisted, no DB, resets on remount.
  const [subject, setSubject] = useState<{ id: number; name: string } | null>(null)

  // Re-readable so the zero-data state can flip the panel into the real AI
  // experience the moment a lead exists. Kept separate from the mount effect below
  // so a refresh never re-emits `general_mode.opened`. The server stays the
  // entitlement authority: a refresh can return `locked` and the locked branch wins.
  const loadBriefing = useCallback(() => {
    getDailyBriefing()
      .then(setBriefing)
      .catch(() => setBriefing({ kind: 'briefing', greeting: '', sections: [] }))
  }, [])

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
    if (inFlightRef.current) return
    inFlightRef.current = true
    const conversationState = lastStateRef.current
    setTranscript((t) => [...t, { role: 'user', text }])
    setAsking(true)
    try {
      // The Agent path sends the question and nothing else. It never throws, so
      // a failure is a rendered turn rather than a transcript that just stops.
      if (agentEnabled) {
        const res = await withLoader(true, () => askAgentApi(text))
        // `=== false`, not `!res.ok`: this repo runs with strictNullChecks off,
        // where a boolean discriminant does not narrow a union (same reason the
        // Agent tools compare `verdict.allowed === false`).
        if (res.ok === false) setTranscript((t) => [...t, { role: 'agentError', reason: res.reason }])
        else setTranscript((t) => [...t, { role: 'agent', result: res.result }])
        return
      }
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
  /**
   * The SERVER's entitlement answer, which outranks the seeded context if the
   * two ever disagree. When it says locked, the body owns the locked state and
   * the footer must not render a second copy of it.
   */
  const serverLocked = briefing?.kind === 'locked'

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
        {/* ZERO DATA (not entitlement). A real interactive state: the composer below
            stays mounted alongside it. Never collapsed with the locked branch. */}
        {isEmptySystem && transcript.length === 0 && <GeneralEmptyState onDataChanged={loadBriefing} />}
        {/*
          A lapsed subscription is not an empty briefing and not a failure: the
          server now says so deterministically, and the panel says the same
          thing the rest of the product says. No briefing cards, no quick
          questions, no fabricated sample output that would imply a request ran.
        */}
        {serverLocked && (
          <div className='py-2'>
            <SubscriptionExpiredState mode='panel' source='ai_panel' feature='חידוש המנוי מחזיר את העוזר החכם.' />
          </div>
        )}
        {briefing?.kind === 'briefing' && transcript.length === 0 && (
          // Pre-question: Daily Briefing + quick-question chips.
          <div className='space-y-2.5 pb-2'>
            <BriefingCards greeting={briefing.greeting} sections={briefing.sections} />
            <div className='space-y-1.5'>
              <p className='text-[12px] text-gray-400'>שאלות מהירות</p>
              {/*
                  Locked chips are `disabled`, not merely un-clickable. The
                  audit found locked AI controls that CSS had taken out of the
                  pointer's reach while leaving them in the tab order — a
                  keyboard user could still fire a paid request the product had
                  just told them was suspended. `disabled` removes them from the
                  tab order and announces the state, which CSS cannot do.
                */}
              <SuggestionChips items={briefingSuggestions()} onPick={(t) => ask(t)} disabled={expired} />
            </div>
          </div>
        )}

        {/* Conversation. Rendered whenever the panel has data of EITHER kind — a
            question asked with zero leads must show its answer, or the composer
            would submit into nothing. `!serverLocked` keeps the locked body the
            single owner of an entitlement-blocked panel. */}
        {!serverLocked && briefing && transcript.length > 0 && (
          <div className='space-y-2.5 pb-2'>
            {transcript.map((turn, i) => {
              if (turn.role === 'user') {
                return (
                  <p key={i} className='text-sm text-gray-800'>
                    <span className='font-medium text-gray-500'>אתה: </span>
                    {turn.text}
                  </p>
                )
              }
              if (turn.role === 'agent') {
                return (
                  <div key={i} className='gm-answer-enter'>
                    <AgentAnswerView result={turn.result} />
                  </div>
                )
              }
              if (turn.role === 'agentError') {
                return (
                  <div key={i} className='gm-answer-enter'>
                    <AgentErrorView reason={turn.reason} />
                  </div>
                )
              }
              return (
                <div key={i} className='gm-answer-enter'>
                  <AnswerView
                    interactive={i === lastAssistantIndex}
                    answer={turn.answer}
                    onPick={(t) => ask(t)}
                    onPickLead={(id, label) => pickLead(id, label)}
                  />
                </div>
              )
            })}
            {showLoader && (
              <ActiveGenerationRow
                fallbackLabel='מגבש תשובה'
                hint='general-mode'
                startPhase='pulse'
                escalateAfterMs={loaderEscalates ? LOADER_ESCALATE_MS : undefined}
              />
            )}
          </div>
        )}
      </div>

      {/* AVAILABILITY, not data state: `hasAnyLeads` (isEmptySystem) no longer gates
          the composer — that conflation is what made the zero-lead panel a dead end
          with no input. `!serverLocked` is UNCHANGED: the locked body still owns an
          entitlement-blocked panel, and the `expired` swap below is untouched, so no
          paid AI request becomes reachable. */}
      {!serverLocked && briefing && (
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
            <SubscriptionExpiredState mode='inline' source='ai_panel' feature='חידוש המנוי מחזיר את העוזר החכם' />
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
