// Route coverage — the guarantee that no route silently reintroduces the defect.
//
// The desktop-handoff work fixed seven sections that rendered a desktop table
// inside the phone shell. Fixing them is worth little on its own: the NEXT route
// added to `app/(app)` would arrive in exactly the same state, and nobody would
// notice until a customer on a phone did.
//
// So this walks the filesystem rather than a hand-written list. Every top-level
// route under `app/(app)` must be accounted for in `lib/mobile/desktopOnlyRoutes.ts`
// — either as a section that hands off to the computer, or as a route with a
// real phone presentation. Adding a route without making that decision fails
// here, on the commit that adds it.
//
// This test deliberately does NOT check HOW a route is branched. It checks that
// somebody decided. The decision itself is asserted by mobileDesktopHandoff.test.tsx
// and by the route's own behaviour.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DESKTOP_ONLY_ROUTES,
  MOBILE_READY_ROUTES,
  LEAD_TAB_SECTIONS,
  MOBILE_READY_LEAD_TAB,
} from '@/lib/mobile/desktopOnlyRoutes'

const APP_DIR = path.join(process.cwd(), 'app', '(app)')

/**
 * The top-level route segments that actually render a page.
 *
 * Route GROUPS — `(admin_settings)`, `(user_settings)` — are parentheses-wrapped
 * and contribute no URL segment, so they are transparent here exactly as they
 * are to the router. A directory only counts once it contains a `page.tsx`
 * somewhere beneath it.
 */
function topLevelRoutes(): string[] {
  const found = new Set<string>()

  const hasPage = (dir: string): boolean => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === 'page.tsx') return true
      if (entry.isDirectory() && hasPage(path.join(dir, entry.name))) return true
    }
    return false
  }

  for (const entry of fs.readdirSync(APP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(APP_DIR, entry.name)
    if (!hasPage(full)) continue
    // A group at the top level would contribute its own children, not itself.
    if (entry.name.startsWith('(')) continue
    found.add('/' + entry.name)
  }

  return [...found].sort()
}

/** Both ledgers, reduced to the top-level segment each entry covers. */
function decidedRoutes(): Set<string> {
  const decided = new Set<string>()
  for (const { path: p } of Object.values(DESKTOP_ONLY_ROUTES)) decided.add('/' + p.split('/')[1])
  for (const p of Object.keys(MOBILE_READY_ROUTES)) decided.add('/' + p.split('/')[1])
  return decided
}

describe('every (app) route has a declared mobile decision', () => {
  test('the walk finds the routes we expect (the test itself is not silently empty)', () => {
    const routes = topLevelRoutes()
    expect(routes.length).toBeGreaterThan(10)
    // Anchors: one known handoff, one known mobile screen, one known desktop-only.
    expect(routes).toContain('/dashboard')
    expect(routes).toContain('/tasks')
    expect(routes).toContain('/sum_sales')
  })

  test('no top-level route is undecided', () => {
    const decided = decidedRoutes()
    const undecided = topLevelRoutes().filter((r) => !decided.has(r))

    expect(
      undecided,
      undecided.length
        ? `These (app) routes have no mobile decision. A phone would render their DESKTOP page inside ` +
            `MobileWorkspaceShell. Add each to DESKTOP_ONLY_SECTIONS + DESKTOP_ONLY_ROUTES (with a gate in ` +
            `the page) or to MOBILE_READY_ROUTES (with a real phone presentation): ${undecided.join(', ')}`
        : '',
    ).toEqual([])
  })

  test('neither ledger lists a route that no longer exists', () => {
    const routes = new Set(topLevelRoutes())
    for (const [section, { path: p }] of Object.entries(DESKTOP_ONLY_ROUTES)) {
      expect(routes.has('/' + p.split('/')[1]), `${section} → ${p}`).toBe(true)
    }
    for (const p of Object.keys(MOBILE_READY_ROUTES)) {
      expect(routes.has('/' + p.split('/')[1]), p).toBe(true)
    }
  })

  test('a route is never on both ledgers at the same granularity', () => {
    const desktopOnly = new Set(Object.values(DESKTOP_ONLY_ROUTES).map((r) => r.path))
    for (const p of Object.keys(MOBILE_READY_ROUTES)) {
      // `/clients` (desktop-only list) and `/clients/[clientId]` (mobile detail)
      // legitimately share a segment — that is why the ledger records exact paths.
      expect(desktopOnly.has(p), `${p} is claimed by both ledgers`).toBe(false)
    }
  })
})

describe('the gates are actually wired into the routes', () => {
  /**
   * A ledger entry is a claim; this checks the claim is backed by code. Reading
   * the source is crude, but the alternative — trusting the list — is how a
   * registry drifts from the app it describes.
   */
  const GATE = 'isMobileWorkspaceRequest'

  const GATED_FILES: Record<string, string> = {
    tasks: 'app/(app)/tasks/page.tsx',
    calendar: 'app/(app)/calendar/page.tsx',
    deals: 'app/(app)/deals/page.tsx',
    clients: 'app/(app)/clients/page.tsx',
    // Gated at the LAYOUT: ביצועים is five pages sharing one desktop surface.
    sum_sales: 'app/(app)/sum_sales/layout.tsx',
    files: 'app/(app)/files/page.tsx',
    promotion: 'app/(app)/promotion/page.tsx',
  }

  test.each(Object.entries(GATED_FILES))('%s gates on the device class and renders the handoff', (section, file) => {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    expect(src, `${file} must consult the device class`).toContain(GATE)
    expect(src, `${file} must return the handoff`).toContain(`section='${section}'`)
  })

  test('the campaign DETAIL route is gated too — a direct URL is not a way around the handoff', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/(app)/promotion/[id]/page.tsx'), 'utf8')
    expect(src).toContain(GATE)
  })

  test('clients/layout.tsx is NOT gated — it wraps the mobile lead-detail route', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/(app)/clients/layout.tsx'), 'utf8')
    expect(src).not.toContain(GATE)
  })

  test('clients/[clientId]/layout.tsx is NOT gated either', () => {
    // It returns `children` on a phone so the summary tab can render its own
    // mobile screen. Gating here would take סיכום ליד down with the others.
    const src = fs.readFileSync(path.join(process.cwd(), 'app/(app)/clients/[clientId]/layout.tsx'), 'utf8')
    expect(src).not.toContain(GATE)
  })
})

/**
 * The lead-detail tabs — the nested gap the audit found.
 *
 * `ClientNav` is not rendered on a phone, so these are reachable only by typing
 * the URL. That is still reachable, and each one used to serve a desktop table
 * inside the phone shell. This walks the tab directories rather than trusting a
 * list, so a NEW tab added under `clients/[clientId]/` fails here until somebody
 * decides what a phone should see.
 */
describe('lead-detail tabs are all decided', () => {
  const LEAD_DIR = path.join(APP_DIR, 'clients', '[clientId]')

  function leadTabs(): string[] {
    return fs
      .readdirSync(LEAD_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(LEAD_DIR, e.name, 'page.tsx')))
      .map((e) => e.name)
      .sort()
  }

  test('the walk finds the real tabs', () => {
    const tabs = leadTabs()
    expect(tabs).toContain(MOBILE_READY_LEAD_TAB)
    expect(tabs.length).toBeGreaterThanOrEqual(4)
  })

  test('every tab except summary is declared desktop-only', () => {
    const undecided = leadTabs().filter((t) => t !== MOBILE_READY_LEAD_TAB && !LEAD_TAB_SECTIONS[t])
    expect(
      undecided,
      undecided.length
        ? `Lead tabs with no mobile decision — a phone would render their DESKTOP page inside ` +
            `MobileWorkspaceShell: ${undecided.join(', ')}`
        : '',
    ).toEqual([])
  })

  test('summary is NOT declared desktop-only — it is the real mobile lead screen', () => {
    expect(LEAD_TAB_SECTIONS[MOBILE_READY_LEAD_TAB]).toBeUndefined()
    expect(MOBILE_READY_ROUTES['/clients/[clientId]/summary']).toBeTruthy()
    const src = fs.readFileSync(path.join(LEAD_DIR, 'summary', 'page.tsx'), 'utf8')
    expect(src).toContain('LeadDetailMobile')
    expect(src).not.toContain('MobileDesktopOnly')
  })

  test('EVERY page under a desktop-only tab is gated, including nested detail routes', () => {
    // `billing/new` and `billing/[invoiceId]` are the ones a direct URL would
    // otherwise slip through.
    const missing: string[] = []
    for (const [tab, section] of Object.entries(LEAD_TAB_SECTIONS)) {
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (entry.name === 'page.tsx') {
            const src = fs.readFileSync(full, 'utf8')
            const rel = path.relative(process.cwd(), full)
            if (!src.includes('isMobileWorkspaceRequest')) missing.push(`${rel} (no gate)`)
            else if (!src.includes(`section='${section}'`)) missing.push(`${rel} (wrong section)`)
          }
        }
      }
      walk(path.join(LEAD_DIR, tab))
    }
    expect(missing, missing.join(', ')).toEqual([])
  })
})
