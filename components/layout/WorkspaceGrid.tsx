import type { ReactNode } from 'react'

/**
 * The desktop workspace grid: nav rail, then the page.
 *
 * It used to widen a third column and fade in a hairline rail when the copilot
 * panel opened. Both are gone with the panel — the assistant is a destination
 * now (`/agent`), so there is no side surface for the grid to make room for and
 * no panel state for it to subscribe to. Dropping that subscription is what
 * takes `'use client'` off this file: it is markup again, with no client
 * runtime, on every page in the app.
 *
 * `.workspace-grid`'s third track (`0px`) and the `.copilot-open` /
 * `.workspace-rail` rules in main.css are left in place, unreferenced, rather
 * than removed in a UI change that is not about the stylesheet.
 */
export default function WorkspaceGrid({ children }: { children: ReactNode }) {
  return <div className='desktop:grid workspace-grid flex-1 min-h-0'>{children}</div>
}
