import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// Meta/drift guards: the pure domain layer must stay pure (INV-6) and free of
// business-day SQL / client clocks. If a rule leaks out of its single source of
// truth, one of these fails the build.

const TODAY_DIR = path.resolve(__dirname, '..', '..', 'lib', 'today')
// service.ts is the sole I/O orchestrator (composition root); it may import the db
// layer. Every OTHER lib/today file is pure domain logic and must stay pure.
const PURE_EXCLUDE = new Set(['service.ts'])
const files = readdirSync(TODAY_DIR).filter((f) => f.endsWith('.ts') && !PURE_EXCLUDE.has(f))

const DB_TODAY_DIR = path.resolve(__dirname, '..', '..', 'db', 'today')
const dbFiles = readdirSync(DB_TODAY_DIR).filter((f) => f.endsWith('.ts'))

describe('lib/today purity (INV-6)', () => {
  it('has files', () => expect(files.length).toBeGreaterThan(0))

  it.each(['react', '@/config/db', 'knex', 'next/', '/ai/', 'openai', 'gemini', 'anthropic'])(
    'no lib/today file imports %s',
    (banned) => {
      for (const f of files) {
        const src = readFileSync(path.join(TODAY_DIR, f), 'utf8')
        const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l))
        for (const line of importLines) expect(line.toLowerCase()).not.toContain(banned)
      }
    },
  )

  it('no raw business-day SQL or wall-clock reads in the pure layer', () => {
    for (const f of files) {
      const src = readFileSync(path.join(TODAY_DIR, f), 'utf8')
      expect(src).not.toContain('date_trunc')
      expect(src).not.toContain('CURRENT_DATE')
      expect(src).not.toMatch(/Date\.now\(\)/)
    }
  })
})

describe('db/today SQL hygiene (INV-2/8/15, single-source config)', () => {
  it('has files', () => expect(dbFiles.length).toBeGreaterThan(0))

  it('no pagination, no business-day SQL, no hardcoded thresholds', () => {
    for (const f of dbFiles) {
      const src = readFileSync(path.join(DB_TODAY_DIR, f), 'utf8')
      expect(src).not.toMatch(/\.limit\(/) // INV-2/15: the brief never paginates
      expect(src).not.toMatch(/\.offset\(/)
      expect(src).not.toContain('date_trunc') // INV-8: bounds come from the domain layer
      expect(src).not.toContain('CURRENT_DATE')
      expect(src).not.toContain("'auto_response'") // C-2 marker must come from constants, not a literal
    }
  })
})
