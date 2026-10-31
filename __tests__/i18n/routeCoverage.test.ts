import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every product page is classified, and the classification is checked against its source.
 *
 * A page is one of:
 *  - LOCALIZED — the page itself calls a locale entry point (`getUiLocaleState`, `getServerT`, `getPreLoginLocale`),
 *    or re-exports a default component that does;
 *  - CLIENT_ROOT — the page renders one client root that calls `useT()` AND declares its region
 *    (`useRegionAttrs` / `regionAttrs`); listed by hand with that root's path;
 *  - REDIRECT — the page only calls `redirect()` and renders nothing;
 *  - EXCLUDED — not translated on purpose, with the reason.
 *
 * A new `page.tsx` fails here until it is classified. Stale entries fail too (a listed page that is gone, an excluded
 * page that started calling a locale entry point, a "redirect" that renders markup).
 */

const APP = 'app'

/** Whole trees outside the i18n phases (CLAUDE.md / phaseF brief). */
const OUT_OF_SCOPE_TREES: Record<string, string> = {
  'app/(marketing)': 'marketing site incl. the legal pages (terms, privacy, data-deletion) — out of scope',
  'app/admin': 'platform owner console — out of scope',
  'app/api': 'route handlers (incl. the wedding module) — no pages',
}

const EXCLUDED: Record<string, string> = {
  'app/(app)/agent/page.tsx': 'AI (owner order: no AI localization) — only its shell title / More row are chrome',
  'app/(app)/settings/(admin_settings)/ai-inspector/page.tsx': 'AI admin tooling (owner order: no AI localization)',
}

const CLIENT_ROOT: Record<string, string> = {
  'app/(app)/settings/(admin_settings)/edit_teams/page.tsx': 'components/agntsAndGrps/TeamCard.tsx',
}

const REDIRECTS = [
  'app/(app)/settings/(admin_settings)/connections/page.tsx',
  'app/(app)/settings/(user_settings)/calendar/page.tsx',
  'app/(app)/settings/(user_settings)/facebook/page.tsx',
]

const SERVER_ENTRY = /\b(getUiLocaleState|getServerT|getPreLoginLocale)\(/

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) pages(p, out)
    else if (name === 'page.tsx') out.push(relative('.', p))
  }
  return out
}

const read = (p: string) => readFileSync(p, 'utf8')

/** Source without block / line comments (a comment such as `?error=<reason>` is not markup). */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** `@/x/y` → the module's file on disk. */
function resolveModule(spec: string): string | null {
  const base = spec.replace(/^@\//, '')
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) if (existsSync(base + ext)) return base + ext
  return null
}

function isLocalized(page: string): boolean {
  const src = code(page)
  if (SERVER_ENTRY.test(src)) return true
  const reexport = src.match(/export \{ default \} from '(@\/[^']+)'/)
  const target = reexport && resolveModule(reexport[1])
  return !!target && SERVER_ENTRY.test(code(target))
}

const inScope = pages(APP)
  .filter((p) => !Object.keys(OUT_OF_SCOPE_TREES).some((tree) => p.startsWith(tree + '/')))
  .sort()

describe('route coverage', () => {
  it('enumerates the real route tree (not vacuous)', () => {
    expect(inScope.length).toBeGreaterThan(50)
    for (const tree of Object.keys(OUT_OF_SCOPE_TREES)) expect(existsSync(tree)).toBe(true)
  })

  it('every in-scope page is classified', () => {
    const unclassified = inScope.filter(
      (p) => !isLocalized(p) && !(p in CLIENT_ROOT) && !REDIRECTS.includes(p) && !(p in EXCLUDED),
    )
    expect(unclassified).toEqual([])
  })

  it('no listed page is stale', () => {
    const listed = [...Object.keys(EXCLUDED), ...Object.keys(CLIENT_ROOT), ...REDIRECTS]
    expect(listed.filter((p) => !inScope.includes(p))).toEqual([])
  })

  it.each(Object.entries(EXCLUDED))('%s stays excluded (%s)', (page) => {
    expect(isLocalized(page)).toBe(false)
  })

  it.each(Object.entries(CLIENT_ROOT))('%s renders the translated client root %s', (page, root) => {
    const pageSrc = read(page)
    const importPath = '@/' + root.replace(/\.tsx?$/, '')
    expect(pageSrc).toContain(`from '${importPath}'`)
    const rootSrc = read(root)
    expect(rootSrc).toMatch(/\buseT\(\)/)
    expect(rootSrc).toMatch(/\b(useRegionAttrs|regionAttrs)\(/)
  })

  it.each(REDIRECTS)('%s only redirects', (page) => {
    const src = code(page)
    expect(src).toMatch(/\bredirect\(/)
    expect(src).not.toMatch(/<[A-Za-z][\w.]*[\s/>]/)
  })

  it('the classifier bites: a page without an entry point is not localized', () => {
    expect(isLocalized(Object.keys(CLIENT_ROOT)[0])).toBe(false)
    expect(isLocalized('app/(app)/leads/page.tsx')).toBe(true)
  })
})
