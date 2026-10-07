'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { simulateQuestionnaireDraft } from '@/actions/questionnaire/builderPublish'
import { explainKept, explainReason, explainRecognized } from '@/lib/inbox/autoresponse/questionnaire/builder/explainText'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { SimulatedTurn } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import ChatBubble from './ChatBubble'
import { SIMULATE_COPY } from './builderCopy'

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
}: {
  model: BuilderQuestionnaire
  target: { draftId: number } | { revision: number }
  /** Runs before every turn: the editor saves pending changes. False aborts the turn. */
  prepare?: () => Promise<boolean>
  onClose?: () => void
  /** The editor opens it on request, so the cursor goes straight to the message box. */
  autoFocus?: boolean
}) {
  const id = useId()
  const [sent, setSent] = useState<string[]>([])
  const [turns, setTurns] = useState<SimulatedTurn[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ title: string; fields: Array<{ label: string; value: string }> } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  async function send() {
    const text = input.trim()
    if (!text || pending) return
    setError(null)
    setPending(true)
    try {
      if (prepare && !(await prepare())) {
        setError('לא הצלחנו לשמור את השינויים האחרונים, ולכן הבדיקה לא רצה.')
        return
      }
      const next = [...sent, text]
      const res = await simulateQuestionnaireDraft({ ...target, turns: next.map((m) => [m]) })
      if (res.ok === false) {
        setError(SIMULATE_COPY[res.reason] ?? 'הבדיקה לא הצליחה. נסו שוב.')
        return
      }
      setSent(next)
      setTurns(res.turns)
      setInput('')
      setStatus(res.status === 'completed' ? 'השאלון הסתיים. כך הנציג יקבל את הסיכום:' : null)
      setSummary(res.status === 'completed' ? res.summary : null)
    } catch {
      setError('הבדיקה לא הצליחה. נסו שוב.')
    } finally {
      setPending(false)
      try {
        endRef.current?.scrollIntoView?.({ block: 'nearest' })
      } catch {
        /* not scrollable here */
      }
    }
  }

  const restart = () => {
    setSent([])
    setTurns([])
    setStatus(null)
    setSummary(null)
    setError(null)
    inputRef.current?.focus()
  }

  return (
    <section aria-labelledby={`${id}-title`} className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 id={`${id}-title`} className='text-base font-semibold text-ink'>
          בדיקת השאלון
        </h2>
        <div className='flex items-center gap-3.5'>
          <button type='button' onClick={restart} className='text-sm text-gray-600 underline underline-offset-2'>
            שיחה חדשה
          </button>
          {onClose && (
            <button type='button' onClick={onClose} className='text-sm text-gray-600 underline underline-offset-2'>
              חזרה לתצוגה המקדימה
            </button>
          )}
        </div>
      </div>
      <p className='text-sm leading-relaxed text-gray-600'>
        זו סימולציה. לא נשלחת הודעה בוואטסאפ, לא נוצר ליד, ואף אחד מהצוות לא מקבל התראה.
      </p>

      <div
        role='log'
        aria-label='שיחת הבדיקה'
        aria-live='polite'
        className='flex max-h-[calc(100vh-18rem)] min-h-64 flex-col gap-2.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4'
      >
        {turns.length === 0 && (
          <p className='m-auto max-w-xs text-center text-sm text-gray-500'>כתבו הודעה כמו שלקוח היה כותב, למשל "היי".</p>
        )}
        {turns.map((turn, i) => (
          <div key={i} className='flex flex-col gap-2.5'>
            {turn.customer.map((m, n) => (
              <ChatBubble key={`c${n}`} from='customer' text={m} label='אתם, כלקוח' />
            ))}
            {turn.replies.map((r, n) => (
              <ChatBubble key={`r${n}`} from='business' text={r} label='תשובת השאלון' />
            ))}
            {turn.replies.length === 0 && <p className='self-end text-xs text-gray-500'>השאלון לא שלח הודעה בתור הזה.</p>}
            <details className='self-end max-w-[88%] text-xs text-gray-600'>
              <summary className='cursor-pointer underline-offset-2 hover:underline'>למה המערכת בחרה בזה?</summary>
              <div className='mt-1 grid gap-1 rounded-md border border-gray-200 bg-white p-2'>
                <p>{explainReason(turn.explanation)}</p>
                {explainRecognized(model, turn.explanation).map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {explainKept(turn.explanation).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </details>
          </div>
        ))}
        {status && <p className='mt-2 text-center text-xs text-gray-600'>{status}</p>}
        {summary && (
          <div className='rounded-md border border-gray-200 bg-white p-3 text-sm'>
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
        {pending && <p className='self-end text-xs text-gray-500'>בודק…</p>}
        <div ref={endRef} />
      </div>

      {error && (
        <p role='alert' className='text-sm text-red-600'>
          {error}
        </p>
      )}

      <div className='flex flex-wrap items-center gap-2.5'>
        <label htmlFor={`${id}-input`} className='sr-only'>
          הודעה כלקוח
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
          disabled={pending}
          placeholder='כתבו כאן כמו לקוח…'
          className='min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:outline-2 focus:outline-offset-0 focus:outline-primary'
        />
        <Btn type='button' lbl={pending ? 'בודק…' : 'שליחה'} onClick={() => void send()} disabled={pending || !input.trim()} />
      </div>
    </section>
  )
}
