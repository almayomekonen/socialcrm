'use client'

import { useEffect } from 'react'
import { useCopilot } from '@/lib/copilot/useCopilot'
import CopilotPanel from './CopilotPanel'

export default function CopilotShell() {
  const { enabled, open, closePanel } = useCopilot()

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
      className={`hidden desktop:block fixed top-20 end-0 bottom-8 w-[320px] z-900 bg-white border rounded-s-md rounded-ee-md copilot-shell ${
        open ? 'copilot-shell-open' : 'copilot-shell-closed'
      }`}
    >
      <CopilotPanel />
    </aside>
  )
}
