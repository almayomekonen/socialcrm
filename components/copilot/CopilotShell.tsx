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
      className={`hidden desktop:block h-full min-h-0 w-[320px] bg-white copilot-shell ${
        open ? 'copilot-shell-open' : 'copilot-shell-closed'
      }`}
    >
      {generalModeEnabled && !ctx ? <GeneralModePanel /> : <CopilotPanel />}
    </aside>
  )
}
