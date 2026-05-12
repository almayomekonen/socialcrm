'use client'

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CopilotContext } from './copilotContext'

/**
 * The copilot context store is intentionally separate from the open/closed
 * panel state managed by `useCopilot`. Two different concerns:
 *
 *  - `useCopilot()`         — UX state (is the panel open? did the user toggle?)
 *  - `useCopilotContext()`  — data state (what context is the active route publishing?)
 *
 * Keeping them apart means a route mounting a context publisher does NOT
 * cause the panel to re-render when toggling, and vice versa.
 *
 * Publication model (server-driven):
 *   1. A server component (e.g. `<CopilotLeadContext leadId={...} />`)
 *      computes the fully-serialized context.
 *   2. It renders `<CopilotContextHydrator context={...} />` (this file).
 *   3. The hydrator's `useEffect` registers the context into the store on
 *      mount and clears it on unmount.
 *
 * This means no client-side fetching, no waterfall, and no `useEffect`-on-
 * route-change polling. Context lives where the data already lives — on the
 * server tree.
 *
 * Stacking model:
 *   We expose `register(context)` which returns an `unregister()` cleanup.
 *   Multiple publishers along the route tree can coexist; the most recent
 *   wins. This handles edge cases like a deep child publishing a more
 *   specific context than its parent.
 */

type Subscription = { id: number; ctx: CopilotContext }

type CopilotContextApi = {
  context: CopilotContext | null
  /** Server publishers register through this. Returns a cleanup. */
  register: (ctx: CopilotContext) => () => void
}

const NOOP_CONTEXT_API: CopilotContextApi = {
  context: null,
  register: () => () => undefined,
}

const Ctx = createContext<CopilotContextApi>(NOOP_CONTEXT_API)

export function CopilotContextStoreProvider({ children }: { children: ReactNode }) {
  const idRef = useRef(0)
  const [stack, setStack] = useState<Subscription[]>([])

  const register = useCallback((ctx: CopilotContext) => {
    const id = ++idRef.current
    setStack((s) => [...s, { id, ctx }])
    return () => {
      setStack((s) => s.filter((sub) => sub.id !== id))
    }
  }, [])

  // Most-recently-registered wins.
  const context = stack.length ? stack[stack.length - 1].ctx : null

  const api = useMemo<CopilotContextApi>(() => ({ context, register }), [context, register])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useCopilotContext(): CopilotContext | null {
  return useContext(Ctx).context
}

/**
 * Tiny hydrator client island. Server components render this with a
 * fully-serialized context payload; on mount it registers the context into
 * the store, on unmount it removes it.
 *
 * Renders nothing (`null`).
 */
export function CopilotContextHydrator({ context }: { context: CopilotContext }) {
  const { register } = useContext(Ctx)
  // Stable JSON snapshot key — guarantees we re-register only when the
  // serialized content actually changes (route param changes, status
  // changes after a server action invalidation, etc).
  const key = useMemo(() => JSON.stringify(context), [context])

  useEffect(() => {
    return register(context)
    // We deliberately key on the JSON snapshot, not the object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, register])

  return null
}
