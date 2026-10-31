import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUARDED_ROOTS, HEBREW_SOURCE_FILES, OUT_OF_SCOPE_PREFIXES } from './hebrewSourceAllowlist'

/**
 * Source-level Hebrew guard for the UI layer. The leak gate proves rendered screens; this catches a Hebrew literal
 * typed into a translated component (or a new file) before any surface renders it. Comments are ignored.
 */

const HEB = /[\u0590-\u05FF]/

/** Drops block and line comments, keeping string / template contents (per line, like the F6 sweep script). */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat(m.split('\n').length - 1))
  return noBlocks
    .split('\n')
    .map((line) => {
      let quote: string | null = null
      let out = ''
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (quote) {
          out += c
          if (c === '\\') {
            out += line[i + 1] ?? ''
            i++
          } else if (c === quote) quote = null
        } else if (c === "'" || c === '"' || c === '`') {
          quote = c
          out += c
        } else if (line.startsWith('//', i)) break
        else out += c
      }
      return out
    })
    .join('\n')
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(relative('.', p))
  }
  return out
}

const withHebrew = GUARDED_ROOTS.flatMap((root) => sources(root))
  .filter((f) => !OUT_OF_SCOPE_PREFIXES.some((prefix) => f.startsWith(prefix)))
  .filter((f) => HEB.test(stripComments(readFileSync(f, 'utf8'))))
  .sort()

describe('Hebrew literals in UI source', () => {
  it('scans the real tree (not vacuous)', () => {
    expect(withHebrew.length).toBeGreaterThan(50)
  })

  it('only allow-listed files contain Hebrew literals', () => {
    expect(withHebrew.filter((f) => !(f in HEBREW_SOURCE_FILES))).toEqual([])
  })

  it('no allow-listed file is stale (shrink the list when Hebrew leaves a file)', () => {
    expect(Object.keys(HEBREW_SOURCE_FILES).filter((f) => !withHebrew.includes(f))).toEqual([])
  })

  it('the comment stripper keeps strings and drops comments', () => {
    expect(HEB.test(stripComments("// הערה\nconst a = 1 /* עוד */"))).toBe(false)
    expect(HEB.test(stripComments("const url = 'https://x' // הערה"))).toBe(false)
    expect(HEB.test(stripComments("toast('message', 'שלום')"))).toBe(true)
    expect(HEB.test(stripComments('<p>שלום</p>'))).toBe(true)
  })
})
