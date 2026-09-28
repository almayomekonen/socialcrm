'use client'

import Icon from '@/lib/Icon'
import { AGENT_SUGGESTIONS } from './agentSuggestions'

/**
 * The resting state, before the first question.
 *
 * It announces readiness and offers four openers. It carries NO other call to
 * action: the composer below is the only interaction on this page, and anything
 * competing with it pulls the user out of the conversation the page exists to
 * start — the same rule the copilot's own empty state follows.
 *
 * INK ON THE APP BACKGROUND. This block used to be white type on a navy canvas
 * of its own; it now uses the same ink/gray hierarchy as every other SocialCRM
 * screen, on the same `--color-bg`.
 *
 * The openers are ORDINARY CARDS — white surface, hairline border, `rounded-md`,
 * no shadow — because that is what a surface looks like in this product. Their
 * one agent-specific note is the hover, which borrows `--color-accent`: the
 * design system defines it as the AI / selection highlight, so the identity
 * comes from the existing token rather than from a private palette.
 */
export default function AgentIntro({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className='flex flex-col items-center px-1 text-center'>
      {/* Solid white, deliberately: the one opaque object on the page, so the
          eye lands on the mark before it reads the title. */}
      <span className='flex size-14 items-center justify-center rounded-md border bg-primary-tint'>
        <Icon name='sparkles' type='sol' className='size-6 bg-primary' />
      </span>

      <h1 className='mt-6 text-[32px] font-semibold leading-tight tracking-[-0.02em] text-ink desktop:text-[42px]'>
        הסוכן שלך
      </h1>
      <p className='mt-2.5 text-[17px] font-semibold tracking-[-0.01em] text-ink desktop:text-[19px]'>
        העוזר החכם של העסק שלך
      </p>
      <p className='mt-3 max-w-lg text-[15px] font-medium leading-relaxed text-gray-600 desktop:text-base'>
        אני כאן כדי לעזור לך לנהל את העסק, להבין מה קורה ולטפל במה שחשוב.
      </p>

      <p className='mt-10 text-[12px] font-semibold tracking-[0.1em] text-gray-600'>מה תרצה לעשות?</p>

      <div className='mt-4 grid w-full max-w-2xl gap-2.5 desktop:grid-cols-2'>
        {AGENT_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type='button'
            onClick={() => onPick(s)}
            className={[
              'press rounded-md border bg-white px-5 py-4 text-start text-[15px] font-medium text-ink',
              'transition-colors duration-200 motion-reduce:transition-none',
              // The accent is the design system's own "AI / selection highlight";
              // it is the agent's identity here, not a new palette.
              'hover:border-accent hover:bg-primary-tint',
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
