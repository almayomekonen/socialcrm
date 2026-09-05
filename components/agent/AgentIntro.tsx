'use client'

import Icon from '@/lib/Icon'
import { AGENT_SUGGESTIONS } from './agentMockData'

/**
 * The resting state, before the first question.
 *
 * It announces readiness and offers four openers. It carries NO other call to
 * action: the composer below is the only interaction on this page, and anything
 * competing with it pulls the user out of the conversation the page exists to
 * start — the same rule the copilot's own empty state follows.
 *
 * The `sparkles` mark and the muted supporting scale are lifted from
 * `components/copilot/general/GeneralEmptyState`, so the assistant reads as one
 * product idea rather than a second one. No new visual language.
 */
export default function AgentIntro({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className='flex flex-col items-center px-1 text-center'>
      <Icon name='sparkles' type='sol' className='size-7 bg-primary' />

      <h1 className='mt-4 text-2xl font-semibold tracking-tight text-gray-900 desktop:text-[28px]'>הסוכן שלך</h1>
      <p className='mt-1.5 text-[15px] text-gray-600'>העוזר החכם של העסק שלך</p>
      <p className='mt-2 max-w-md text-sm leading-relaxed text-gray-500'>
        אני כאן כדי לעזור לך לנהל את העסק, להבין מה קורה ולטפל במה שחשוב.
      </p>

      <p className='mt-8 text-xs font-medium text-gray-400'>מה תרצה לעשות?</p>

      <div className='mt-3 grid w-full max-w-xl gap-2 desktop:grid-cols-2'>
        {AGENT_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type='button'
            onClick={() => onPick(s)}
            className={[
              'press rounded-2xl border border-border bg-surface px-4 py-3 text-start text-sm text-gray-700',
              'transition-colors duration-150 motion-reduce:transition-none',
              'hover:border-gray-300 hover:bg-gray-50',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            ].join(' ')}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
