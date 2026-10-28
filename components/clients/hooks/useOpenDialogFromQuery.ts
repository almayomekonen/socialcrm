'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

type Args = {
  enabled: boolean
  openAdd: () => void
  openImport: () => void
}

/**
 * Lets another page link straight into the leads table's existing dialogs:
 * `/leads?add=1` opens the add-lead form, `/leads?import=1` opens the upload.
 * Used by the Today hero's "הוסף ליד" / "ייבוא Excel" buttons. Fires once, then
 * strips the param so a refresh or back-navigation does not reopen the dialog.
 * The strip uses the native History API (Next keeps useSearchParams in sync)
 * rather than router.replace: no server re-render, so the page keeps the state
 * it rendered with — e.g. the onboarding tour stays deferred behind the dialog.
 */
export function useOpenDialogFromQuery({ enabled, openAdd, openImport }: Args) {
  const pathname = usePathname()
  const search = useSearchParams()
  const firedRef = useRef(false)

  useEffect(() => {
    if (!enabled || firedRef.current) return
    const add = search.get('add') === '1'
    const upload = search.get('import') === '1'
    if (!add && !upload) return
    firedRef.current = true

    if (add) openAdd()
    else openImport()

    const next = new URLSearchParams(search.toString())
    next.delete('add')
    next.delete('import')
    const qs = next.toString()
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }, [enabled, search, pathname, openAdd, openImport])
}
