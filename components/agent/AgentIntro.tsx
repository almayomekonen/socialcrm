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
 * WHITE ON NAVY. The canvas is dark-dominant (see lib/css/agent.css), so the
 * field behind this block runs #1a2a5c to #0a2540: white clears 12:1 here, and
 * every tier below stays at or above the 4.5:1 floor — /70 is the weakest used,
 * at about 7:1. Nothing on this canvas is dimmer than that.
 *
 * The openers are GLASS, not solid tiles: a translucent white wash over a dark
 * field reads as a lit surface, where the near-solid white cards the light canvas
 * needed would now punch holes in it. Depth is a hairline top-lit ring plus a
 * soft drop shadow, and hover raises both the wash and the ring together.
 */
export default function AgentIntro({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className='flex flex-col items-center px-1 text-center'>
      {/* Solid white, deliberately: the one opaque object on the page, so the
          eye lands on the mark before it reads the title. */}
      <span className='flex size-14 items-center justify-center rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.18),0_18px_40px_-16px_rgba(0,0,0,0.55)]'>
        <Icon name='sparkles' type='sol' className='size-6 bg-primary' />
      </span>

      <h1 className='mt-6 text-[32px] font-semibold leading-tight tracking-[-0.02em] text-white desktop:text-[42px]'>
        הסוכן שלך
      </h1>
      <p className='mt-2.5 text-[17px] font-semibold tracking-[-0.01em] text-white desktop:text-[19px]'>
        העוזר החכם של העסק שלך
      </p>
      <p className='mt-3 max-w-lg text-[15px] font-medium leading-relaxed text-white/70 desktop:text-base'>
        אני כאן כדי לעזור לך לנהל את העסק, להבין מה קורה ולטפל במה שחשוב.
      </p>

      <p className='mt-10 text-[12px] font-semibold tracking-[0.1em] text-white/70'>מה תרצה לעשות?</p>

      <div className='mt-4 grid w-full max-w-2xl gap-2.5 desktop:grid-cols-2'>
        {AGENT_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type='button'
            onClick={() => onPick(s)}
            className={[
              'press rounded-2xl bg-white/10 px-5 py-4 text-start text-[15px] font-medium text-white',
              'ring-1 ring-white/20 backdrop-blur-xl',
              'shadow-[0_1px_2px_rgba(0,0,0,0.15),0_12px_28px_-18px_rgba(0,0,0,0.7)]',
              'transition-all duration-200 motion-reduce:transition-none',
              'hover:-translate-y-0.5 hover:bg-white/16 hover:ring-white/35',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
            ].join(' ')}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
