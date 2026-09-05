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
 * Ink on glass, not white on colour. The canvas band behind this block sits
 * around #8b91f0, where ink clears 5.9:1 and white would land at 2.7:1 — so the
 * openers are frosted white tiles with ink text rather than the outline chips
 * this carried on a white page.
 */
export default function AgentIntro({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className='flex flex-col items-center px-1 text-center'>
      <span className='flex size-11 items-center justify-center rounded-2xl bg-white/85 shadow-sm backdrop-blur-sm'>
        <Icon name='sparkles' type='sol' className='size-5 bg-primary' />
      </span>

      <h1 className='mt-4 text-2xl font-semibold tracking-tight text-ink desktop:text-[30px]'>הסוכן שלך</h1>
      <p className='mt-1.5 text-[15px] font-semibold text-ink/85'>העוזר החכם של העסק שלך</p>
      <p className='mt-2 max-w-md text-sm font-medium leading-relaxed text-ink/75'>
        אני כאן כדי לעזור לך לנהל את העסק, להבין מה קורה ולטפל במה שחשוב.
      </p>

      <p className='mt-8 text-xs font-semibold text-ink/70'>מה תרצה לעשות?</p>

      <div className='mt-3 grid w-full max-w-xl gap-2 desktop:grid-cols-2'>
        {AGENT_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type='button'
            onClick={() => onPick(s)}
            className={[
              'press rounded-2xl border border-white/70 bg-white/75 px-4 py-3 text-start text-sm font-medium text-ink',
              'shadow-sm backdrop-blur-md transition-all duration-200 motion-reduce:transition-none',
              'hover:-translate-y-0.5 hover:border-white hover:bg-white/95 hover:shadow-md',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40',
            ].join(' ')}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
