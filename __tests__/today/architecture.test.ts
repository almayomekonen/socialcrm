import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// Meta/drift guards: the pure domain layer must stay pure (INV-6) and free of
// business-day SQL / client clocks. If a rule leaks out of its single source of
// truth, one of these fails the build.

const TODAY_DIR = path.resolve(__dirname, '..', '..', 'lib', 'today')
const files = readdirSync(TODAY_DIR).filter((f) => f.endsWith('.ts'))

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
