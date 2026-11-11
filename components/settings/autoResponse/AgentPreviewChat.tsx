'use client'

import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import type { AgentPreviewChatState } from './useAgentPreviewChat'

/**
 * The test conversation itself, drawn like the WhatsApp thread it simulates:
 * the business's name over the chat, the customer's bubbles on one side and the
 * agent's green bubbles on the other, and a composer underneath.
 *
 * Rendered by `AgentPreview` in the desktop side panel and in the narrow-screen
 * dialog; the conversation state is the caller's, so both show the same chat.
 *
 * RTL. The bubbles keep the inbox's in/out geometry so a reply looks here as it
 * will there; the corners and the note icon use logical properties.
 *
 * LANGUAGE. AI output / AI configuration, out of scope by owner order (no AI
 * localization): the caller renders this inside a declared Hebrew region.
 */
type Props = {
  chat: AgentPreviewChatState
  businessName: string
  /** The owner has written about the business. Without it there is nothing to test. */
  hasDescription: boolean
  /** The description being tested differs from the saved one. */
  isDraft: boolean
}

export default function AgentPreviewChat({ chat, businessName, hasDescription, isDraft }: Props) {
  const { bubbles, input, setInput, pending, error, reset, send, endRef } = chat
  return (
    <div className='flex flex-col'>
      <div className='flex flex-wrap items-baseline justify-between gap-2.5'>
        <h2 className='text-base font-semibold text-ink'>בדיקת הסוכן</h2>
        {bubbles.length > 0 && (
          <button type='button' onClick={reset} className='text-sm text-gray-600 underline underline-offset-2'>
            שיחה חדשה
          </button>
        )}
      </div>

      <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>
        זו סימולציה. לא נשלחת הודעה בוואטסאפ, לא נוצר ליד, ואף אחד מהצוות לא מקבל התראה.
      </p>

      {hasDescription && (
        <p className='mt-1.5 text-sm text-gray-600'>
          {isDraft ? (
            <span className='font-medium text-ink'>נבדק לפי הטקסט שכתבתם עכשיו ועדיין לא שמרתם.</span>
          ) : (
            <span>נבדק לפי ההגדרות השמורות.</span>
          )}
        </p>
      )}

      <div dir='rtl' className='mt-4 overflow-hidden rounded-lg border border-gray-200'>
        {/* The thread header: who the customer is talking to. */}
        <div className='flex items-center gap-2.5 border-b border-gray-200 bg-white px-4 py-2.5'>
          <Icon type='reg' name='whatsapp' className='size-4.5 shrink-0 bg-[#25D366]' />
          <span className='truncate text-sm font-semibold text-ink'>{businessName || 'העסק'}</span>
        </div>

        <div className='flex max-h-[26rem] min-h-56 flex-col gap-2.5 overflow-y-auto bg-gray-50 p-4'>
          {bubbles.length === 0 && (
            <p className='m-auto max-w-sm text-center text-sm text-gray-500'>
              {hasDescription
                ? `כתבו הודעה כמו שלקוח היה כותב, ותראו איך ${businessName || 'העסק'} עונה.`
                : 'כתבו קודם על העסק כדי לבדוק את הסוכן.'}
            </p>
          )}
          {bubbles.map((b) => (
            /*
              The width cap sits on THIS wrapper — the flex item, whose 80% resolves
              against the chat column — not on the bubble. On the bubble, a
              percentage resolved against this shrink-to-fit wrapper, i.e. against
              the bubble's own text width, so every message was capped below its
              own length and even "מה קורה?" wrapped.
            */
            <div key={b.id} className={b.direction === 'inbound' ? 'max-w-[80%] self-start' : 'max-w-[80%] self-end'}>
              {b.text && (
                <div
                  className={
                    b.direction === 'inbound'
                      ? 'rounded-lg rounded-ee-sm border border-gray-200 bg-white px-3.5 py-2 text-sm leading-relaxed break-words'
                      : 'rounded-lg rounded-es-sm border border-[#25D366]/35 bg-[#25D366]/12 px-3.5 py-2 text-sm leading-relaxed break-words'
                  }
                >
                  {b.text}
                </div>
              )}
              {b.note && (
                <div className='mt-1 flex items-start gap-1 text-xs leading-relaxed text-gray-500'>
                  <Icon type='reg' name='info' className='mt-[3px] size-3 shrink-0 bg-gray-400' />
                  <p>{b.note}</p>
                </div>
              )}
            </div>
          ))}
          {pending && <p className='self-end text-xs text-gray-500'>הסוכן מקליד…</p>}
          <div ref={endRef} />
        </div>

        <div className='flex items-center gap-2.5 border-t border-gray-200 bg-white p-2.5'>
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
            disabled={pending || !hasDescription}
            aria-label='הודעה כלקוח'
            placeholder='כתבו כאן כמו לקוח…'
            className='min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:outline-2 focus:outline-offset-0 focus:outline-primary disabled:bg-gray-50'
          />
          <Btn type='button' lbl={pending ? 'שולח…' : 'שליחה'} onClick={() => void send()} disabled={pending || !input.trim() || !hasDescription} />
        </div>
      </div>

      {error && (
        <p role='alert' className='mt-2 text-sm text-red-600'>
          {error}
        </p>
      )}
    </div>
  )
}
