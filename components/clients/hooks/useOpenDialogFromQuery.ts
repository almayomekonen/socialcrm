'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

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
 */
export function useOpenDialogFromQuery({ enabled, openAdd, openImport }: Args) {
  const router = useRouter()
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
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [enabled, search, router, pathname, openAdd, openImport])
}
