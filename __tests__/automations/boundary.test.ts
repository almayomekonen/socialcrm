import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Domain boundary guard — Platform Emails vs Customer Automations
// (docs/email-automations-plan.md §0). The two email domains must never
// import each other: a platform change must be unable to affect a lead, and a
// customer-automation change must be unable to affect a platform user. Scans
// import/export/require specifiers statically; engine directories that don't
// exist yet pass vacuously, so this guard predates the engine on purpose.
// Runs DB-less (pure fs) — VITEST_NO_DB=1 compatible.

const ROOT = process.cwd()

// Customer Automation Engine surfaces (present or planned).
const ENGINE_DIRS = [
  'lib/automations',
  'db/automations',
  'actions/automations',
  'components/settings/automations',
  'app/api/automations',
]

// Platform-email domain surfaces.
const PLATFORM_DIRS = ['lib/emailAutomations']

// Modules engine code may never reach (platform registry, platform send/
// suppression stores, and the Resend audience emitter — lead PII must never
// flow to platform marketing tooling).
const FORBIDDEN_FOR_ENGINE = [
  'lib/emailAutomations',
  'db/emailAutomationSends',
  'db/emailSuppressions',
  'lib/events/emit',
]

// Modules platform code may never reach.
const FORBIDDEN_FOR_PLATFORM = ['lib/automations', 'db/automations', 'actions/automations']

function listSourceFiles(relDir: string): string[] {
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

function importSpecifiers(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8')
  const specs: string[] = []
  const patterns = [
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g, // static import/re-export
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import()
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g, // side-effect import
    /require\(\s*['"]([^'"]+)['"]\s*\)/g, // CJS require
  ]
  for (const re of patterns) {
    for (let m = re.exec(src); m; m = re.exec(src)) specs.push(m[1])
  }
  return specs
}

// Resolve a specifier to a ROOT-relative path, or null for external packages.
function normalize(spec: string, fileDir: string): string | null {
  if (spec.startsWith('@/')) return spec.slice(2)
  if (spec.startsWith('.')) return path.relative(ROOT, path.resolve(fileDir, spec))
  return null
}

function violations(sourceDirs: string[], forbidden: string[]): string[] {
  const found: string[] = []
  for (const dir of sourceDirs) {
    for (const file of listSourceFiles(dir)) {
      for (const spec of importSpecifiers(file)) {
        const target = normalize(spec, path.dirname(file))
        if (!target) continue
        if (forbidden.some((f) => target === f || target.startsWith(`${f}/`))) {
          found.push(`${path.relative(ROOT, file)} → ${spec}`)
        }
      }
    }
  }
  return found
}

describe('platform/customer email domain boundary (spec §0)', () => {
  it('engine code never imports the platform email domain', () => {
    expect(violations(ENGINE_DIRS, FORBIDDEN_FOR_ENGINE)).toEqual([])
  })

  it('platform email code never imports the engine domain', () => {
    expect(violations(PLATFORM_DIRS, FORBIDDEN_FOR_PLATFORM)).toEqual([])
  })
})
