// Regression guard for an RSC-boundary crash.
//
// WHAT BROKE. `STATUS_STYLES` lived in `components/clients/LeadStatusCell.tsx`,
// a `'use client'` module. A Server Component that imports a plain object from a
// client module does not receive the object — it receives a client-reference
// proxy whose properties read as `undefined`. The mobile lead card did
// `STATUS_STYLES[status].bg` and threw `Cannot read properties of undefined
// (reading 'bg')` on every render of `/leads`.
//
// WHY THE VIEWPORT HARNESS MISSED IT. The harness renders components in jsdom,
// where there is no server/client boundary at all, so the import resolves to the
// real object and the page measured perfectly. Layout QA cannot see this class
// of bug; only a running server or a static check can. Hence this file.
//
// Guarantees locked in:
//   1. The values live in a framework-neutral module (no 'use client').
//   2. `statusStyle()` never returns undefined — unknown/legacy/null statuses
//      fall back rather than crashing the screen they appear on.
//   3. Every status in the product vocabulary has a complete style.
//   4. The old import path still works, so existing consumers are unbroken.
//   5. NO Server Component imports these values from the client module. This is
//      the guard that actually prevents a recurrence.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { STATUS_STYLES, STATUS_OPTIONS, statusStyle } from '@/lib/leads/statusStyles'

const VOCABULARY = ['new', 'contacted', 'interested', 'closed', 'lost']

describe('lead status styles', () => {
  test('1. the source module is framework-neutral (no "use client" directive)', () => {
    const src = fs.readFileSync('lib/leads/statusStyles.ts', 'utf8')
    // A "use client" DIRECTIVE must be the first statement in the module, so
    // only the first meaningful line matters. Matching anywhere in the file
    // would fail on the docblock, which discusses the boundary in prose.
    const firstStatement = src
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'))
    expect(firstStatement).toBeDefined()
    expect(/^['"]use client['"]/.test(firstStatement!)).toBe(false)
  })

  test('2. statusStyle() never returns undefined', () => {
    for (const s of [...VOCABULARY, null, undefined, '', 'archived', 'NEW', 'לא-קיים']) {
      const style = statusStyle(s as string | null | undefined)
      expect(style, `statusStyle(${JSON.stringify(s)})`).toBeTruthy()
      // These four are interpolated straight into className — undefined here is
      // the exact crash this file exists to prevent.
      expect(typeof style.bg).toBe('string')
      expect(typeof style.text).toBe('string')
      expect(typeof style.border).toBe('string')
      expect(typeof style.dot).toBe('string')
      expect(style.label.length).toBeGreaterThan(0)
    }
  })

  test('2b. an unknown status falls back to "new", not to a blank chip', () => {
    expect(statusStyle('archived')).toEqual(STATUS_STYLES.new)
    expect(statusStyle(null)).toEqual(STATUS_STYLES.new)
  })

  test('3. every status in the vocabulary has a complete style', () => {
    for (const s of VOCABULARY) {
      expect(Object.keys(STATUS_STYLES)).toContain(s)
      expect(STATUS_STYLES[s].label.length).toBeGreaterThan(0)
    }
    expect(STATUS_OPTIONS).toHaveLength(VOCABULARY.length)
  })

  test('4. the previous import path still resolves (existing consumers unbroken)', async () => {
    const viaCell = await import('@/components/clients/LeadStatusCell')
    expect(viaCell.STATUS_STYLES).toBe(STATUS_STYLES)
    expect(viaCell.STATUS_OPTIONS).toEqual(STATUS_OPTIONS)
  })

  test('5. no Server Component imports these values from the client module', () => {
    const roots = ['app', 'components', 'modules', 'lib']
    const offenders: string[] = []

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue
          walk(p)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        const src = fs.readFileSync(p, 'utf8')
        if (!src.includes("from '@/components/clients/LeadStatusCell'")) continue
        // A client module may import from another client module freely.
        const isClient = /^\s*['"]use client['"]/.test(src.split('\n')[0] ?? '')
        // Importing the COMPONENT is always fine — only the plain values break.
        const importsValues = /import\s*\{[^}]*\b(STATUS_STYLES|STATUS_OPTIONS|statusStyle)\b[^}]*\}\s*from\s*'@\/components\/clients\/LeadStatusCell'/.test(
          src,
        )
        if (!isClient && importsValues) offenders.push(p)
      }
    }
    for (const r of roots) walk(r)

    expect(
      offenders,
      `These Server Components import plain values across the RSC boundary and will read them as undefined at runtime. Import from '@/lib/leads/statusStyles' instead:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
