'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { simulateQuestionnaireDraft } from '@/actions/questionnaire/builderPublish'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { SimulatedTurn } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { useRefocusAfterTurn } from '@/hooks/useRefocusAfterTurn'
import SimulatorTurn from './SimulatorTurn'
import type { PhraseSuggestion } from '@/lib/inbox/autoresponse/questionnaire/builder/phraseSuggestion'
import { simulateFailureIn } from './copyIn'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import { untranslatedAttrs } from '@/lib/i18n/config'

const HEBREW = translatorFor('he')

/** What stopped a turn, worded where it is shown: an unsaved draft, a refusal by code, or a failure. */
type Problem = { kind: 'prepare' } | { kind: 'refused'; reason: string } | { kind: 'failed' }

/**
 * "בדיקת השאלון": the owner writes like a customer and sees exactly what the
 * questionnaire would answer.
 *
 * Every reply comes from PR1's `simulate`, which runs the production decision
 * code on a transcript held only in this component. No WhatsApp message, no
 * conversation, no lead, no model call. The whole conversation is replayed on
 * each turn (simulate is stateless), so what is shown is always one coherent
 * run of the current definition.
 *
 * `target` says WHICH definition: the draft being edited (saved first by the
 * caller) or a published revision (the mobile view tests what is live).
 */
export default function QuestionnaireSimulator({
  model,
  target,
  prepare,
  onClose,
  autoFocus = false,
  onNotReady,
  onTeach,
  translated = false,
}: {
  model: BuilderQuestionnaire
  target: { draftId: number } | { revision: number }
  /** Runs before every turn: the editor saves pending changes. False aborts the turn. */
  prepare?: () => Promise<boolean>
  onClose?: () => void
  /** The editor opens it on request, so the cursor goes straight to the message box. */
  autoFocus?: boolean
  /** The draft cannot be tested yet: the editor should show what to fix. */
  onNotReady?: () => void
  /** Editing a draft: offer to teach a phrase the test did not recognise (owner-only, outside the chat). */
  onTeach?: (s: PhraseSuggestion) => void
  /** Follow the interface language (the desktop builder). Default Hebrew: the phone view (Phase F) is not translated yet. */
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const id = useId()
  const [sent, setSent] = useState<string[]>([])
  const [turns, setTurns] = useState<SimulatedTurn[]>([])
  const [finished, setFinished] = useState(false)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Problem | null>(null)
  /** The answer a phrase was just taught to. */
  const [notice, setNotice] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ title: string; fields: Array<{ label: string; value: string }> } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restartRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const completed = useRef(false)
  const refocus = useRefocusAfterTurn(sectionRef, inputRef, restartRef)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  /** Run (or re-run) the whole conversation so far through the real simulator. */
  async function run(messages: string[]): Promise<boolean> {
    setError(null)
    setPending(true)
    try {
      if (prepare && !(await prepare())) {
        setError({ kind: 'prepare' })
        return false
      }
      const res = await simulateQuestionnaireDraft({ ...target, turns: messages.map((m) => [m]) })
      if (res.ok === false) {
        if (res.reason === 'not_ready') onNotReady?.()
        setError({ kind: 'refused', reason: res.reason })
        return false
      }
      setSent(messages)
      setTurns(res.turns)
      setFinished(res.status === 'completed')
      setSummary(res.status === 'completed' ? res.summary : null)
      completed.current = res.status === 'completed'
      return true
    } catch {
      setError({ kind: 'failed' })
      return false
    } finally {
      setPending(false)
      try {
        endRef.current?.scrollIntoView?.({ block: 'nearest' })
      } catch {
        /* not scrollable here */
      }
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || pending) return
    setNotice(null)
    if (await run([...sent, text])) setInput('')
    refocus(completed.current)
  }

  /**
   * The owner taught a phrase: the same conversation is run again at once, so
   * they see it continue down the right route instead of resending anything.
   */
  async function teach(s: PhraseSuggestion) {
    if (!onTeach) return
    onTeach(s)
    setNotice(s.optionLabel)
    await run(sent)
    // The note (and its button) is gone once the phrase is understood.
    refocus(completed.current)
  }

  const restart = () => {
    setSent([])
    setTurns([])
    setFinished(false)
    setSummary(null)
    setError(null)
    setNotice(null)
    completed.current = false
    inputRef.current?.focus()
  }

  return (
    <section ref={sectionRef} aria-labelledby={`${id}-title`} className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 id={`${id}-title`} className='text-base font-semibold text-ink'>
          {t('admin.questionnaire.simulator.title')}
        </h2>
        <div className='flex items-center gap-3.5'>
          <button ref={restartRef} type='button' onClick={restart} className='text-sm text-gray-600 underline underline-offset-2'>
            {t('admin.questionnaire.simulator.restart')}
          </button>
          {onClose && (
            <button type='button' onClick={onClose} className='text-sm text-gray-600 underline underline-offset-2'>
              {t('admin.questionnaire.simulator.back')}
            </button>
          )}
        </div>
      </div>
      <p className='text-sm leading-relaxed text-gray-600'>{t('admin.questionnaire.simulator.disclaimer')}</p>

      <div
        role='log'
        aria-label={t('admin.questionnaire.simulator.log')}
        aria-live='polite'
        className='flex max-h-[calc(100vh-18rem)] min-h-64 flex-col gap-2.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4'
      >
        {turns.length === 0 && (
          <p className='m-auto max-w-xs text-center text-sm text-gray-500'>{t('admin.questionnaire.simulator.empty')}</p>
        )}
        {turns.map((turn, i) => (
          <SimulatorTurn key={i} model={model} turn={turn} onTeach={onTeach ? (s) => void teach(s) : undefined} t={t} />
        ))}
        {notice && (
          <p role='status' className='rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-950'>
            {t('admin.questionnaire.simulator.taught', { option: notice })}
          </p>
        )}
        {finished && <p className='mt-2 text-center text-xs text-gray-600'>{t('admin.questionnaire.simulator.completed')}</p>}
        {summary && (
          // The summary the rep receives, exactly as the runtime writes it.
          <div className='rounded-md border border-gray-200 bg-white p-3 text-sm' {...untranslatedAttrs(t.locale)}>
            <p className='font-semibold'>{summary.title}</p>
            <dl className='mt-1 grid gap-0.5'>
              {summary.fields.map((f, n) => (
                <div key={n} className='flex gap-1'>
                  <dt className='text-gray-600'>{f.label}:</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {pending && <p className='self-end text-xs text-gray-500'>{t('admin.questionnaire.simulator.checking')}</p>}
        <div ref={endRef} />
      </div>

      {error && (
        <p role='alert' className='text-sm text-red-600'>
          {error.kind === 'prepare'
            ? t('admin.questionnaire.simulator.prepareFailed')
            : ((error.kind === 'refused' && simulateFailureIn(error.reason, t)) || t('admin.questionnaire.simulator.failed'))}
        </p>
      )}

      <div className='flex flex-wrap items-center gap-2.5'>
        <label htmlFor={`${id}-input`} className='sr-only'>
          {t('admin.questionnaire.simulator.input')}
        </label>
        <input
          id={`${id}-input`}
          ref={inputRef}
          type='text'
          value={input}
          maxLength={1000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          // Read-only, not disabled, while a turn is checked: a disabled field
          // drops the cursor to the page, and the owner would have to find
          // the box again after every reply.
          readOnly={pending}
          aria-busy={pending}
          placeholder={t('admin.questionnaire.simulator.placeholder')}
          className='min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:outline-2 focus:outline-offset-0 focus:outline-primary'
        />
        <Btn type='button' lbl={pending ? t('admin.questionnaire.simulator.checking') : t('admin.questionnaire.simulator.send')} onClick={() => void send()} disabled={pending || !input.trim()} />
      </div>
    </section>
  )
}
