/**
 * Page tokens are sealed at rest. A reader that uses `page_access_token`
 * without `resolvePageAccessToken` would send ciphertext to Meta, get error 190,
 * and mark a healthy Page — and its Lead Ads — as disconnected. This guard
 * fails the build when a new reader appears without going through the resolver.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'
import { isSealedPageAccessToken, resolvePageAccessToken, sealPageAccessToken } from '@/lib/facebook/pageToken'

const ROOT = process.cwd()
const SOURCE_DIRS = ['app', 'lib', 'modules', 'components', 'actions', 'db', 'scripts']

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name !== 'node_modules' && name !== 'baseline' && name !== 'migrations') walk(p)
      } else if (/\.(ts|tsx|cjs|js|mjs)$/.test(name)) out.push(p)
    }
  }
  SOURCE_DIRS.forEach((d) => walk(join(ROOT, d)))
  return out
}

/** Files allowed to touch the column: each must also call the resolver or the sealer. */
const RESOLVER = /resolvePageAccessToken\(|sealPageAccessToken\(|resolvePageToken\(/

describe('every page_access_token reader resolves the sealed value', () => {
  it('no file touches the column — property, bracket, destructuring or select list — without the resolver or sealer', () => {
    const offenders = sourceFiles()
      .filter((f) => !f.endsWith('lib/facebook/pageToken.ts'))
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
          .split('\n')
          .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
          .join('\n')
        return /\bpage_access_token\b/.test(src) && !RESOLVER.test(src)
      })
      .map((f) => relative(ROOT, f))
    expect(offenders).toEqual([])
  })

  it('every property read of the column sits inside a resolver call (line-level)', () => {
    const unwrapped: string[] = []
    for (const f of sourceFiles()) {
      if (f.endsWith('lib/facebook/pageToken.ts') || f.endsWith('scripts/resolvePageToken.cjs')) continue
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!/\.page_access_token\b/.test(line)) return
          if (RESOLVER.test(line) || /secrets\.push\(/.test(line)) return
          unwrapped.push(`${relative(ROOT, f)}:${i + 1}`)
        })
    }
    expect(unwrapped).toEqual([])
  })
})

describe('seal / resolve', () => {
  it('round-trips, never stores the plaintext, and passes legacy plaintext rows through', () => {
    process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 1).toString('base64')
    const sealed = sealPageAccessToken('EAAG-real-token')
    expect(isSealedPageAccessToken(sealed)).toBe(true)
    expect(sealed).not.toContain('EAAG-real-token')
    expect(resolvePageAccessToken(sealed)).toBe('EAAG-real-token')
    expect(resolvePageAccessToken('EAAG-legacy-plaintext')).toBe('EAAG-legacy-plaintext')
    expect(resolvePageAccessToken(null)).toBe('')
  })

  it('a seal that cannot be opened throws (never an empty token Meta would read as expired)', () => {
    process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 1).toString('base64')
    const sealed = sealPageAccessToken('x')
    process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 2).toString('base64')
    expect(() => resolvePageAccessToken(sealed)).toThrow()
  })
})
