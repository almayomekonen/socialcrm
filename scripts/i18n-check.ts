/**
 * `pnpm i18n:check` — translation coverage for the UI catalogs.
 * Exits non-zero on any missing / malformed / untranslated / unused key.
 * Rules live in lib/i18n/coverage.ts; the same rules run in __tests__/i18n.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCatalogs, unusedKeys } from '../lib/i18n/coverage'
import { CATALOGS } from '../lib/i18n/messages'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN = ['app', 'components', 'lib', 'modules', 'actions']

export function readSources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (full.includes(`${path.sep}i18n${path.sep}messages`)) continue
        walk(full)
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        out.push(fs.readFileSync(full, 'utf8'))
      }
    }
  }
  for (const dir of SCAN) walk(path.join(ROOT, dir))
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = checkCatalogs(CATALOGS)
  const unused = unusedKeys(CATALOGS.he, readSources())
  for (const i of issues) console.error(`[${i.locale}] ${i.kind}: ${i.key}${i.detail ? ` (${i.detail})` : ''}`)
  for (const key of unused) console.error(`[he] unused: ${key}`)
  if (issues.length || unused.length) process.exit(1)
  console.log(`i18n: ${Object.keys(CATALOGS).join(', ')} complete`)
}
