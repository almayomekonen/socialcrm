'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import AgentIntro from './AgentIntro'
import AgentPromptInput, { type PromptMeta } from './AgentPromptInput'
import AgentThread from './AgentThread'
import { mockAnswerFor, type AgentTurn } from './agentMockData'

/**
 * "הסוכן שלך" — the agent workspace.
 *
 * UI PROTOTYPE. Every answer comes from `agentMockData` in this same folder;
 * this component calls no API, reads no CRM data and writes nothing. The notice
 * under the composer says so on screen, because a surface that shows invented
 * lead names without saying they are invented is the one thing the care charter
 * forbids outright (Law 1). Replacing the `mockAnswerFor` call with the real
 * agent is the only change this file needs when the backend is wired.
 *
 * The canvas is `.agent-canvas` (lib/css/agent.css) — the reference's gradient
 * composition rebuilt from this product's own tokens, anchored on the navy the
 * nav rail is painted with. Foreground text is ink, never white; see that file.
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
 */
export default function AgentWorkspace() {
  const [turns, setTurns] = useState<AgentTurn[]>([])
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(0)

  const ask = useCallback((prompt: string, _meta?: PromptMeta) => {
    const text = prompt.trim()
    if (!text) return
    const answer = mockAnswerFor(text)
    // One state update for both turns: appending the question, painting, then
    // appending the answer would animate the thread twice for one action.
    setTurns((prev) => [
      ...prev,
      { id: `u${nextId.current++}`, role: 'user', text },
      { id: `a${nextId.current++}`, role: 'agent', text: answer.text, cards: answer.cards },
    ])
    setInput('')
  }, [])

  useEffect(() => {
    if (turns.length === 0) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' })
  }, [turns.length])

  const started = turns.length > 0

  return (
    <div className='agent-canvas flex min-h-full flex-1 flex-col'>
      {started && (
        <div className='mx-auto flex w-full max-w-3xl justify-end px-4 pb-2 pt-2 desktop:px-0'>
          <button
            type='button'
            onClick={() => setTurns([])}
            className='tap-44 rounded-lg bg-white/70 px-2.5 py-1 text-[13px] font-medium text-ink/80 backdrop-blur-sm transition-colors hover:bg-white/80 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 motion-reduce:transition-none'
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
        {started ? <AgentThread turns={turns} /> : <AgentIntro onPick={ask} />}
        <div ref={endRef} />
      </div>

      <div className='sticky bottom-0 z-10'>
        <div className='mx-auto w-full max-w-3xl px-4 pb-4 pt-3 desktop:px-0'>
          <AgentPromptInput value={input} onChange={setInput} onSubmit={ask} />
          <p className='mt-2.5 text-center text-[11px] font-medium leading-relaxed text-ink/70'>
            תצוגה מקדימה. התשובות והכרטיסים בעמוד הזה הם נתוני דוגמה ואינם מהעסק שלך.
          </p>
        </div>
      </div>
    </div>
  )
}
