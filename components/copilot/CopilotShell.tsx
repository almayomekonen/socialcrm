'use client'

import { useEffect } from 'react'
import { useCopilot } from '@/lib/copilot/useCopilot'

// BISECT: Copilot subtree disabled — hooks preserved, renders nothing.
export default function CopilotShell(_props: { generalModeEnabled?: boolean }) {
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

  return null
}
