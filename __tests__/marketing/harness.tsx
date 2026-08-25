/**
 * Shared render harness for the marketing guardrail suite.
 *
 * Marketing pages are ordinary React components, but two things stop them
 * rendering under vitest and neither is application behaviour:
 *
 *  1. `MarketingNavbar` imports `@/actions/auth`, which reaches `config/db` at
 *     module scope — so importing ANY marketing page currently demands a
 *     DATABASE_URL. (That coupling is itself a finding; the header is due to
 *     take auth state as a prop instead of importing a server action.)
 *  2. jsdom implements none of the browser APIs the reveal/motion components
 *     touch — see `./domPolyfills`.
 *
 * Callers declare the two `vi.mock` calls themselves, with INLINE factories.
 * Vitest hoists `vi.mock` above the import block, so a factory imported from
 * this file would be referenced before initialisation — the mocks cannot be
 * centralised here however much they repeat.
 */

import './domPolyfills'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

export function renderPage(element: ReactElement) {
  return render(element)
}

/** Every JSON-LD payload a rendered page emits, parsed. */
export function structuredData(container: HTMLElement): Record<string, unknown>[] {
  return [...container.querySelectorAll('script[type="application/ld+json"]')].map((node) => {
    const raw = node.textContent ?? ''
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch (cause) {
      throw new Error(`invalid JSON-LD: ${raw.slice(0, 120)}`, { cause })
    }
  })
}

/** Collapses whitespace so rendered Hebrew compares cleanly against source strings. */
export const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
