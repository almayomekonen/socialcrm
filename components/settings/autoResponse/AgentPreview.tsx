'use client'

import { useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { previewAgentTurn, type PreviewTurn } from '@/actions/autoResponse/previewAgent'

/**
 * "בדקו את הסוכן שלכם" — the owner talks to their own agent before a customer
 * does.
 *
 * ISOLATION. The whole conversation lives in this component's state and is
 * posted back on every turn. Nothing is persisted: no WhatsApp send, no
 * conversation row, no lead, no job, no notification, no live handoff. The
 * server action enforces that; this panel states it on screen so the owner is
 * never guessing whether a test message reached a real customer.
 *
 * DRAFT VS SAVED. The owner is usually mid-edit. The panel sends whatever is
 * currently in the textarea, and labels each reply with which it used — testing
 * saved settings and testing unsaved words are different questions and the
 * answer must say which one it answered.
 *
 * RTL. The conversation reads right-to-left like the real thing; bubbles use the
 * same in/out geometry the inbox uses so a reply looks here as it will there.
 */

type Props = {
  /** Current textarea contents, saved or not. */
  draftDescription: string
  draftAgentInstructions: string
  /** What is actually stored, so the panel can tell the owner which it used. */
  savedDescription: string
  businessName: string
}

type Bubble = {
  id: number
  direction: 'inbound' | 'outbound'
  text: string
  note?: string | null
  usedDraft?: boolean
}

const ERROR_COPY: Record<string, string> = {
  no_description: 'כדי לבדוק את הסוכן צריך קודם לכתוב על העסק בשדה למעלה.',
  forbidden: 'רק מנהל יכול לבדוק את הסוכן.',
  ai_unavailable: 'השירות לא זמין כרגע. נסו שוב בעוד רגע.',
  budget_exhausted: 'נגמרה מכסת השימוש היומית. נסו שוב מחר.',
  empty_transcript: 'כתבו הודעה כדי להתחיל.',
  no_pending_inbound: 'כתבו הודעה כדי להתחיל.',
}

let nextId = 1

export default function AgentPreview({
  draftDescription,
  draftAgentInstructions,
  savedDescription,
  businessName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const hasDescription = draftDescription.trim().length > 0
  const isDraft = draftDescription.trim() !== savedDescription.trim()

  function reset() {
    setBubbles([])
    setInput('')
    setError(null)
  }

  async function send() {
    const text = input.trim()
    if (!text || pending) return
    setError(null)
    setInput('')

    const mine: Bubble = { id: nextId++, direction: 'inbound', text }
    const history: PreviewTurn[] = [...bubbles, mine].map((b) => ({ direction: b.direction, text: b.text }))
    setBubbles((prev) => [...prev, mine])
    setPending(true)

    try {
      const result = await previewAgentTurn({
        transcript: history,
        draftDescription,
        draftAgentInstructions,
      })
      if (result.ok === false) {
        setError(ERROR_COPY[result.reason] ?? 'משהו השתבש. נסו שוב.')
        return
      }
      // A silent turn is a real outcome (opt-out, a close). Show the reason
      // rather than an empty bubble, so "nothing happened" is never ambiguous.
      if (!result.reply.trim()) {
        setBubbles((prev) => [
          ...prev,
          { id: nextId++, direction: 'outbound', text: '', note: result.trace.simulated ?? 'הסוכן לא היה שולח כלום כאן.' },
        ])
        return
      }
      setBubbles((prev) => [
        ...prev,
        {
          id: nextId++,
          direction: 'outbound',
          text: result.reply,
          note: result.trace.simulated,
          usedDraft: result.usedDraft,
        },
      ])
    } catch {
      setError('משהו השתבש. נסו שוב.')
    } finally {
      setPending(false)
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'nearest' }))
    }
  }

  if (!open) {
    return (
      <div className='mt-5.5 border-t border-gray-200 pt-5.5'>
        <div className='flex flex-wrap items-center gap-3'>
          <Btn type='button' onClick={() => setOpen(true)} disabled={!hasDescription}>
            בדקו את הסוכן שלכם
          </Btn>
          <p className='text-sm text-gray-600'>
            {hasDescription
              ? 'שיחת בדיקה שלא נשלחת לאף אחד. אפשר לכתוב כמו לקוח ולראות מה הסוכן עונה.'
              : 'כתבו קודם על העסק כדי לבדוק את הסוכן.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <section className='mt-5.5 border-t border-gray-200 pt-5.5'>
      <div className='flex flex-wrap items-baseline justify-between gap-2.5'>
        <h2 className='text-base font-semibold text-ink'>בדיקת הסוכן</h2>
        <div className='flex items-center gap-3.5'>
          <button type='button' onClick={reset} className='text-sm text-gray-600 underline underline-offset-2'>
            שיחה חדשה
          </button>
          <button type='button' onClick={() => setOpen(false)} className='text-sm text-gray-600 underline underline-offset-2'>
            סגירה
          </button>
        </div>
      </div>

      <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>
        זו סימולציה. לא נשלחת הודעה בוואטסאפ, לא נוצר ליד, ואף אחד מהצוות לא מקבל התראה.
      </p>

      <p className='mt-1.5 text-sm text-gray-600'>
        {isDraft ? (
          <span className='font-medium text-ink'>נבדק לפי הטקסט שכתבתם עכשיו ועדיין לא שמרתם.</span>
        ) : (
          <span>נבדק לפי ההגדרות השמורות.</span>
        )}
      </p>

      <div
        dir='rtl'
        className='mt-4 flex max-h-96 min-h-40 flex-col gap-2.5 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4'
      >
        {bubbles.length === 0 && (
          <p className='m-auto max-w-sm text-center text-sm text-gray-500'>
            כתבו הודעה כמו שלקוח היה כותב, ותראו איך {businessName || 'העסק'} עונה.
          </p>
        )}
        {bubbles.map((b) => (
          <div key={b.id} className={b.direction === 'inbound' ? 'self-start' : 'self-end'}>
            {b.text && (
              <div
                className={
                  b.direction === 'inbound'
                    ? 'max-w-[85%] rounded-lg rounded-bl-sm border border-gray-200 bg-white px-3.5 py-2 text-sm leading-relaxed'
                    : 'max-w-[85%] rounded-lg rounded-br-sm border border-[#25D366]/35 bg-[#25D366]/12 px-3.5 py-2 text-sm leading-relaxed'
                }
              >
                {b.text}
              </div>
            )}
            {b.note && (
              <p className='mt-1 max-w-[85%] text-xs leading-relaxed text-gray-500'>
                <Icon type='reg' name='info' className='ml-1 inline-block size-3 bg-gray-400 align-[-1px]' />
                {b.note}
              </p>
            )}
          </div>
        ))}
        {pending && <p className='self-end text-xs text-gray-500'>הסוכן מקליד…</p>}
        <div ref={endRef} />
      </div>

      {error && (
        <p role='alert' className='mt-2 text-sm text-red-600'>
          {error}
        </p>
      )}

      <div dir='rtl' className='mt-3 flex flex-wrap items-center gap-2.5'>
        <input
          type='text'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          disabled={pending}
          aria-label='הודעה כלקוח'
          placeholder='כתבו כאן כמו לקוח…'
          className='min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:outline-2 focus:outline-offset-0 focus:outline-primary'
        />
        <Btn type='button' onClick={() => void send()} disabled={pending || !input.trim()}>
          {pending ? 'שולח…' : 'שליחה'}
        </Btn>
      </div>
    </section>
  )
}
