'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { creatorFor, type InlineCreatorProps } from './firstPartyCreators'

/**
 * Loads the registered creator for a first-party source and renders it.
 *
 * A thin boundary, and worth its own file: it keeps the dynamic import out of
 * the shared dialog — which must not carry a quotation editor for the templates
 * that have nothing to do with quotes — and it keeps the dialog's JSX a plain
 * branch rather than a suspense dance.
 *
 * A source with no creator, or one that fails to load, renders nothing here;
 * the dialog's own `enum_agency` fallback still offers the plain picker.
 */
export default function InlineCreator(props: InlineCreatorProps) {
  const [Creator, setCreator] = useState<ComponentType<InlineCreatorProps> | null>(null)

  useEffect(() => {
    const load = creatorFor(props.variable.optionSource)
    if (!load) return
    let cancelled = false
    load().then((c) => {
      if (!cancelled) setCreator(() => c)
    })
    return () => {
      cancelled = true
    }
  }, [props.variable.optionSource])

  if (!Creator) return <p className='text-sm text-gray-500 ms-1'>טוען…</p>
  return <Creator {...props} />
}
