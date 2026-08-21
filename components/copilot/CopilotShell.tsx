'use client'

import { useEffect } from 'react'
import { useCopilot } from '@/lib/copilot/useCopilot'
import { useCopilotContext } from '@/lib/copilot/copilotContextStore'
import CopilotPanel from './CopilotPanel'
import GeneralModePanel from './general/GeneralModePanel'

export default function CopilotShell({ generalModeEnabled = false }: { generalModeEnabled?: boolean }) {
  const { enabled, open, closePanel } = useCopilot()
  const ctx = useCopilotContext()

  useEffect(() => {
    if (!enabled || !open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, open, closePanel])

  if (!enabled) return null

  return (
    <aside
      role='complementary'
      aria-label='עוזר חכם'
      aria-hidden={!open}
      /*
       * `inert` is what makes the closed panel actually unreachable. Without it
       * `aria-hidden` hid the subtree from assistive tech while leaving every
       * control in the tab order — a focusable element inside an aria-hidden
       * subtree, which is both an a11y violation and how a keyboard user could
       * reach the AI quick questions in a panel they cannot see. CSS
       * (pointer-events) only ever stopped the mouse.
       */
      inert={!open}
      className={`hidden desktop:block h-full min-h-0 w-[320px] bg-white copilot-shell ${
        open ? 'copilot-shell-open' : 'copilot-shell-closed'
      }`}
    >
      {generalModeEnabled && !ctx ? <GeneralModePanel /> : <CopilotPanel />}
    </aside>
  )
}
