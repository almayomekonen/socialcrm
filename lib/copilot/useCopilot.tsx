'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readPersistedOpen, writePersistedOpen } from './copilotState'

type CopilotApi = {
  enabled: boolean
  open: boolean
  toggle: () => void
  openPanel: () => void
  closePanel: () => void
}

const NOOP_API: CopilotApi = {
  enabled: false,
  open: false,
  toggle: () => { },
  openPanel: () => { },
  closePanel: () => { },
}

const CopilotCtx = createContext<CopilotApi>(NOOP_API)

type ProviderProps = { enabled: boolean; children: ReactNode }

export function CopilotProvider({ enabled, children }: ProviderProps) {
  const [open, setOpen] = useState(false)

  // Hydrate from sessionStorage after mount to avoid SSR/client divergence.
  useEffect(() => {
    if (!enabled) return
    setOpen(readPersistedOpen())
  }, [enabled])

  // Persist on change.
  useEffect(() => {
    if (!enabled) return
    writePersistedOpen(open)
  }, [enabled, open])

  const openPanel = useCallback(() => setOpen(true), [])
  const closePanel = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((prev) => !prev), [])

  // Global Cmd/Ctrl + J shortcut. ESC-to-close handled inside the panel.
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      const isShortcut = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j'
      if (!isShortcut) return
      e.preventDefault()
      setOpen((prev) => !prev)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  const api = useMemo<CopilotApi>(
    () => ({ enabled, open, toggle, openPanel, closePanel }),
    [enabled, open, toggle, openPanel, closePanel],
  )

  return <CopilotCtx.Provider value={api}>{children}</CopilotCtx.Provider>
}

export function useCopilot(): CopilotApi {
  return useContext(CopilotCtx)
}
