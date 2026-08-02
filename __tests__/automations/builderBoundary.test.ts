import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * BUILDER BOUNDARY — frozen architecture Law 1 (§5), enforcement per §4 Q5.
 *
 *   "The Builder renders metadata. No integration key appears as a literal in
 *    Builder code. CI-enforced."
 *
 * Two rules:
 *   1. Builder code may not import connector/integration modules.
 *   2. No integration name may appear as a string literal in Builder code.
 *
 * Architectures do not decay by decision; they decay by a hundred small
 * exceptions nobody reviewed. So exemptions below are ENUMERATED, COUNTED, and
 * may only ever shrink — a test asserts the count never grows.
 */

const ROOT = process.cwd()

/** Directories that render the Builder. Grows as B3+ lands. */
const BUILDER_DIRS = ['components/settings/automations', 'lib/automations/catalog']

/** Integration identities that must never be literals in Builder code. */
const INTEGRATION_NAMES = [
  'facebook',
  'instagram',
  'whatsapp',
  'shopify',
  'calendly',
  'zoom',
  'grow',
  'stripe',
  'hubspot',
  'salesforce',
]

/** Module paths Builder code may never import. */
const FORBIDDEN_IMPORTS = ['lib/connectors', 'lib/facebook', 'lib/whatsapp', 'lib/system']

/**
 * LEGACY EXEMPTIONS — EMPTY as of B3, permanently.
 *
 * B0 opened this list with one entry: the pre-catalog Builder hardcoded lead
 * sources in sheetOptions.ts. B3 replaced that with conditions generated from
 * the event's declared `source` field, so the exemption became stale and was
 * deleted — which the staleness check below forced.
 *
 * THIS LIST MAY ONLY SHRINK. It is now empty and must stay empty: adding an
 * entry means Builder code has learned something about an integration, which
 * Law 1 forbids.
 */
const LEGACY_EXEMPT_FILES: string[] = []
const LEGACY_EXEMPT_COUNT = LEGACY_EXEMPT_FILES.length

function sourceFiles(relDir: string): string[] {
  const abs = path.join(ROOT, relDir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
    }
  }
  walk(abs)
  return out
}

const relative = (file: string) => path.relative(ROOT, file)
const isExempt = (file: string) => LEGACY_EXEMPT_FILES.includes(relative(file))

/** Strips comments so documentation may name integrations; code may not. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function builderFiles(): string[] {
  return BUILDER_DIRS.flatMap(sourceFiles)
}

describe('Law 1 — the Builder never becomes integration-aware', () => {
  it('no integration name appears as a string literal in Builder code', () => {
    const violations: string[] = []
    for (const file of builderFiles()) {
      if (isExempt(file)) continue
      const code = codeOnly(fs.readFileSync(file, 'utf8'))
      for (const name of INTEGRATION_NAMES) {
        // Only string literals count — an identifier or a comment does not.
        const literal = new RegExp(`['"\`]${name}['"\`]`, 'i')
        if (literal.test(code)) violations.push(`${relative(file)} → "${name}"`)
      }
    }
    expect(violations).toEqual([])
  })

  it('Builder code never imports connector or integration modules', () => {
    const violations: string[] = []
    for (const file of builderFiles()) {
      const code = codeOnly(fs.readFileSync(file, 'utf8'))
      for (const spec of code.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        const target = spec[1].startsWith('@/') ? spec[1].slice(2) : spec[1]
        if (FORBIDDEN_IMPORTS.some((f) => target === f || target.startsWith(`${f}/`))) {
          violations.push(`${relative(file)} → ${spec[1]}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})

describe('legacy exemptions may only shrink', () => {
  it('the exemption list has not grown', () => {
    expect(LEGACY_EXEMPT_FILES.length).toBeLessThanOrEqual(LEGACY_EXEMPT_COUNT)
  })

  it('every exempt file still exists and still violates — stale exemptions are removed', () => {
    for (const rel of LEGACY_EXEMPT_FILES) {
      const abs = path.join(ROOT, rel)
      expect(fs.existsSync(abs), `${rel} is exempt but missing — delete the exemption`).toBe(true)
      const code = codeOnly(fs.readFileSync(abs, 'utf8'))
      const stillViolates = INTEGRATION_NAMES.some((n) => new RegExp(`['"\`]${n}['"\`]`, 'i').test(code))
      expect(stillViolates, `${rel} no longer violates — delete the exemption`).toBe(true)
    }
  })
})

describe('the boundary guard actually catches violations', () => {
  it('detects an integration literal in a synthetic Builder file', () => {
    const synthetic = `const SOURCES = [{ id: 'shopify', name: 'Shopify' }]`
    const code = codeOnly(synthetic)
    const caught = INTEGRATION_NAMES.some((n) => new RegExp(`['"\`]${n}['"\`]`, 'i').test(code))
    expect(caught).toBe(true)
  })

  it('detects a forbidden import in a synthetic Builder file', () => {
    const synthetic = `import { x } from '@/lib/whatsapp/templates/flag'`
    const targets = [...codeOnly(synthetic).matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) =>
      m[1].startsWith('@/') ? m[1].slice(2) : m[1],
    )
    expect(targets.some((t) => FORBIDDEN_IMPORTS.some((f) => t.startsWith(`${f}/`)))).toBe(true)
  })

  it('does NOT flag an integration name inside a comment', () => {
    const synthetic = `// facebook pages are Sources, not Connections\nconst x = 1`
    expect(codeOnly(synthetic)).not.toMatch(/['"\`]facebook['"\`]/i)
  })
})
