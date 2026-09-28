'use client'

import { useEffect, useRef, useState } from 'react'
import AgentIntro from './AgentIntro'
import AgentPromptInput from './AgentPromptInput'
import AgentThread from './AgentThread'
import { useAgentConversation } from './useAgentConversation'

/**
 * "הסוכן שלך" — the agent workspace.
 *
 * It renders and it routes input. Every other concern lives behind
 * `useAgentConversation`: transport, streaming, history, error mapping. Nothing
 * in this tree calls a model, holds a key, or decides anything about the
 * business — the brief's boundary, made structural rather than promised.
 *
 * The answers are REAL. Each question reaches `POST /api/ai/agent/stream`, which
 * runs the same investigation the rest of the product's agent path runs:
 * server-resolved scope, admission gate, budgeted tool calls against the CRM,
 * and `validateAgentAnswer` dropping any claim the tools did not actually
 * support. Nothing on this page invents CRM content.
 *
 * NO CANVAS OF ITS OWN. This page used to paint a dark navy gradient and set
 * every foreground to white, which made the agent read as a separate product
 * embedded in SocialCRM. It now inherits the app background (`--color-bg`) like
 * every other route, and sits inside the shell's ordinary `.wrap` padding — so
 * the intelligence is new and the surface is not.
 *
 * LAYOUT: one column, composer pinned to the bottom of the scroller.
 *
 * `flex-1` AND `min-h-full` together, on purpose — the two shells hand this page
 * different parents. The mobile shell's `main` is a flex column, where `flex-1`
 * fills it; the desktop `main` is a block element with a definite height from
 * the workspace grid, where `min-h-full` does. Neither alone covers both, and
 * a second `h-dvh` here is what the mobile shell's layout contract forbids.
 *
 * The composer is `sticky`, not `fixed`: fixed would escape the mobile shell and
 * sit on top of the tab bar, and would need the safe-area inset re-solved here.
 * Sticky stays inside the scroll region the shell already sized correctly.
 *
 * MOBILE: header → content (the ONE scroller) → composer → tab bar. Inside the
 * mobile shell this page owns its scrolling (`data-mobile-scroll-owner`, which
 * turns the shell's `main` into a non-scrolling column). The content region
 * scrolls, the composer is a plain in-flow footer below it — so on a real
 * iPhone, where Safari's toolbars leave ~550–660px, the composer can no longer
 * sit on top of the suggestions or the thread. Every mobile rule is keyed to
 * the shell (`in-[[data-mobile-workspace]]:`), never to a width breakpoint: the
 * shell is chosen by device on the server, and desktop never renders it, so the
 * desktop layout above is untouched. The content wrapper is `display: contents`
 * outside the shell for the same reason.
 */
export default function AgentWorkspace() {
  const { turns, busy, ask, reset , decide, decideBatch } = useAgentConversation()
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  function submit(question: string) {
    ask(question)
    setInput('')
  }

  // Follow the thread as turns arrive AND as the thinking row rewrites itself,
  // so a long answer does not land below the fold.
  useEffect(() => {
    if (turns.length === 0) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' })
  }, [turns])

  const started = turns.length > 0
  const startedRef = useRef(started)
  useEffect(() => { startedRef.current = started }, [started])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Mobile: when the content region SHRINKS — the iOS keyboard opening, the
  // composer expanding to type — keep the latest answer in view, but only if the
  // rep was already reading the end. Desktop never fires this: there the region
  // is `display: contents` and has no box to resize.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let atEnd = true
    const onScroll = () => { atEnd = el.scrollHeight - el.clientHeight - el.scrollTop < 24 }
    const ro = new ResizeObserver(() => { if (atEnd && startedRef.current) el.scrollTop = el.scrollHeight })
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll) }
  }, [])

  return (
    <div data-mobile-scroll-owner className='flex min-h-full flex-1 flex-col in-[[data-mobile-workspace]]:min-h-0'>
      <div
        ref={scrollRef}
        data-agent-scroll
        className='contents in-[[data-mobile-workspace]]:flex in-[[data-mobile-workspace]]:min-h-0 in-[[data-mobile-workspace]]:flex-1 in-[[data-mobile-workspace]]:flex-col in-[[data-mobile-workspace]]:overflow-y-auto in-[[data-mobile-workspace]]:overscroll-contain'
      >
        {started && (
          <div className='mx-auto flex w-full max-w-3xl justify-end px-4 pb-2 pt-2 desktop:px-0'>
            <button
              type='button'
              onClick={reset}
              className='tap-44 rounded-md border bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none'
            >
              שיחה חדשה
            </button>
          </div>
        )}

        {/* The conversation canvas. Centred vertically while empty so the intro
            and the composer read as one composition; top-aligned once there is a
            conversation, so answers do not drift down the screen as they arrive. */}
        <div
          className={`mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 desktop:px-0 ${started ? 'justify-start pt-2' : 'justify-center'}`}
        >
          {started ? <AgentThread turns={turns} onDecide={decide} onDecideBatch={decideBatch} /> : <AgentIntro onPick={submit} />}
          <div ref={endRef} />
        </div>
      </div>

      {/*
        THE PLINTH. `sticky` keeps the composer in flow, so the thread scrolls
        UNDER it, and the band needs to be opaque or cards show through behind
        the input.
        It is a FLAT FILL of the app background, not a gradient. The gradient this
        replaced faded to `--color-ink` — it existed to blend the composer into a
        navy canvas that no longer exists, and on the app background a scrim the
        same colour as the page is invisible except for the one thing it is for:
        hiding what scrolls beneath it.
      */}
      <div
        data-agent-composer
        className='sticky bottom-0 z-10 bg-gray pt-10 in-[[data-mobile-workspace]]:static in-[[data-mobile-workspace]]:shrink-0 in-[[data-mobile-workspace]]:pt-2'
      >
        <div className='mx-auto w-full max-w-3xl px-4 pb-4 desktop:px-0 in-[[data-mobile-workspace]]:pb-2'>
          <AgentPromptInput value={input} onChange={setInput} onSubmit={submit} />
          <p className='mt-3 in-[[data-mobile-workspace]]:mt-1.5 text-center text-[12px] font-medium leading-relaxed tracking-[0.01em] text-gray-600'>
            {busy ? 'הסוכן בודק את הנתונים שלך' : 'הסוכן עונה על סמך הנתונים של העסק שלך בלבד.'}
          </p>
        </div>
      </div>
    </div>
  )
}
