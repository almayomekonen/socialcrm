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
 * INK ON GLASS, NOT WHITE ON COLOUR. The canvas band behind this block sits
 * around #8b91f0, where ink clears 5.9:1 and white would land at 2.7:1.
 *
 * The openers are near-solid frosted tiles rather than the translucent ones this
 * had first: at 55% white the purple read straight through and they came out
 * flat lavender, which is what made the block look washed rather than layered.
 * Depth here comes from a real two-part shadow — a tight contact shadow plus a
 * wide soft one — not from opacity.
 */
export default function AgentIntro({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className='flex flex-col items-center px-1 text-center'>
      <span className='flex size-12 items-center justify-center rounded-2xl bg-white ring-1 ring-white/70 shadow-[0_1px_2px_rgba(10,37,64,0.08),0_12px_28px_-14px_rgba(10,37,64,0.5)]'>
        <Icon name='sparkles' type='sol' className='size-5 bg-primary' />
      </span>

      <h1 className='mt-5 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink desktop:text-[34px]'>
        הסוכן שלך
      </h1>
      <p className='mt-2 text-[15px] font-semibold tracking-[-0.01em] text-ink/85'>העוזר החכם של העסק שלך</p>
      <p className='mt-2.5 max-w-md text-sm font-medium leading-relaxed text-ink/70'>
        אני כאן כדי לעזור לך לנהל את העסק, להבין מה קורה ולטפל במה שחשוב.
      </p>

      <p className='mt-9 text-[11px] font-semibold tracking-[0.08em] text-ink/55'>מה תרצה לעשות?</p>

      <div className='mt-3.5 grid w-full max-w-xl gap-2.5 desktop:grid-cols-2'>
        {AGENT_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type='button'
            onClick={() => onPick(s)}
            className={[
              'press rounded-2xl bg-white/90 px-4 py-3.5 text-start text-sm font-medium text-ink',
              'ring-1 ring-white/60 backdrop-blur-xl',
              'shadow-[0_1px_2px_rgba(10,37,64,0.06),0_10px_24px_-16px_rgba(10,37,64,0.55)]',
              'transition-all duration-200 motion-reduce:transition-none',
              'hover:-translate-y-0.5 hover:bg-white hover:ring-white',
              'hover:shadow-[0_2px_4px_rgba(10,37,64,0.08),0_16px_32px_-16px_rgba(10,37,64,0.6)]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/50',
            ].join(' ')}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
