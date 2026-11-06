/**
 * WhatsApp Cloud API tokens are sealed at rest (lib/whatsapp/connectionToken.ts).
 *
 * Two failure modes this file guards, in the build rather than in review:
 *  · a WRITER that skips `sealWhatsappAccessToken` stores a usable token in plaintext;
 *  · a READER that skips `resolveWhatsappAccessToken` sends ciphertext to Meta, gets
 *    error 190, and marks a working number as disconnected.
 * Plus the helper's own contract.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isSealedWhatsappAccessToken,
  resolveWhatsappAccessToken,
  sealWhatsappAccessToken,
  WHATSAPP_TOKEN_SEAL_PREFIX,
} from '@/lib/whatsapp/connectionToken'

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

const code = (f: string) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .map((line) => (/^\s*(\*|\/\/|\/\*)/.test(line) ? '' : line))

/** Files that touch the WhatsApp connection table's token column. */
const touchesColumn = (src: string) => /whatsapp_connections|WaConnectionRow|WabaBackfillRow/.test(src) && /\baccess_token\b/.test(src)

const SEALS_OR_RESOLVES = /sealWhatsappAccessToken\(|resolveWhatsappAccessToken\(/

/**
 * Files that read the stored value WITHOUT resolving it themselves, each with the
 * reason it is safe. Every one hands the stored value, untouched, to
 * `resolveWhatsappHealth` (lib/whatsapp/operationalStatus.ts), which resolves it
 * before any Graph call; whatsappTokenSealing.db.test.ts proves that with a sealed row.
 */
const PASS_THROUGH: Record<string, string> = {
  'lib/inbox/whatsappComposerContext.ts': 'stored value → resolveWhatsappHealth',
  'lib/automations/connectors/whatsapp.ts': 'stored value → resolveWhatsappHealth',
  'lib/connections/healthSweep.ts': 'stored value → resolveWhatsappHealth',
  // Writes the plaintext from Meta into saveConnection, which seals it (proven in the DB test).
  'lib/whatsapp/finishEmbeddedSignup.ts': 'plaintext → saveConnection (seals)',
}

/** Local developer harnesses that seed fake fixture tokens into a local database. */
const FIXTURE_HARNESSES = /^scripts\/e2e\//

describe('every whatsapp_connections.access_token reader and writer goes through the helper', () => {
  it('no file touches the column without sealing or resolving, unless it is a documented pass-through', () => {
    const offenders = sourceFiles()
      .map((f) => ({ f, rel: relative(ROOT, f) }))
      .filter(({ rel }) => rel !== 'lib/whatsapp/connectionToken.ts' && !FIXTURE_HARNESSES.test(rel) && !(rel in PASS_THROUGH))
      .filter(({ f }) => {
        const src = code(f).join('\n')
        return touchesColumn(src) && !SEALS_OR_RESOLVES.test(src)
      })
      .map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })

  it('every documented pass-through still exists and still touches the column (the allowlist cannot rot silently)', () => {
    for (const rel of Object.keys(PASS_THROUGH)) {
      expect(touchesColumn(code(join(ROOT, rel)).join('\n')), rel).toBe(true)
    }
  })

  it('no INSERT, UPDATE or MERGE writes a token value that was not sealed on the same line', () => {
    const unsealed: string[] = []
    for (const f of sourceFiles()) {
      const rel = relative(ROOT, f)
      if (FIXTURE_HARNESSES.test(rel)) continue
      const lines = code(f)
      const src = lines.join('\n')
      if (!/whatsapp_connections/.test(src)) continue
      // Inside a write call, `access_token:` must carry a sealed value.
      let inWrite = 0
      lines.forEach((line, i) => {
        if (/\.(insert|update|merge)\(\s*\{?\s*$|\.(insert|update|merge)\(\{/.test(line)) inWrite = 12
        if (inWrite > 0) {
          inWrite--
          if (/\baccess_token\s*:/.test(line) && !/seal/i.test(line)) unsealed.push(`${rel}:${i + 1}`)
        }
      })
    }
    expect(unsealed).toEqual([])
  })

  it('the token is never interpolated into a log line or an error message', () => {
    const leaks: string[] = []
    for (const f of sourceFiles()) {
      const rel = relative(ROOT, f)
      code(f).forEach((line, i) => {
        if (/console\.(log|warn|error|info)\(|new Error\(|waTrace\(/.test(line) && /\baccess_token\b|\baccessToken\b(?!\s*:)/.test(line)) {
          // A mention in a message string ('access_token' as text) is fine; a value is not.
          if (/\$\{[^}]*(access_token|accessToken)[^}]*\}|,\s*(\w+\.)?(access_token|accessToken)\s*[,)]/.test(line)) leaks.push(`${rel}:${i + 1}`)
        }
      })
    }
    expect(leaks).toEqual([])
  })
})

describe('seal / resolve', () => {
  const key = (n: number) => Buffer.alloc(32, n).toString('base64')
  const original = process.env.SECRETS_ENC_KEY
  afterEach(() => {
    process.env.SECRETS_ENC_KEY = original
  })

  it('round-trips, never contains the plaintext, and every seal is different (random IV)', () => {
    process.env.SECRETS_ENC_KEY = key(1)
    const a = sealWhatsappAccessToken('EAAG-real-wa-token')
    const b = sealWhatsappAccessToken('EAAG-real-wa-token')
    expect(a.startsWith(WHATSAPP_TOKEN_SEAL_PREFIX)).toBe(true)
    expect(a).not.toContain('EAAG-real-wa-token')
    expect(a).not.toBe(b)
    expect(resolveWhatsappAccessToken(a)).toBe('EAAG-real-wa-token')
    expect(resolveWhatsappAccessToken(b)).toBe('EAAG-real-wa-token')
  })

  it('legacy plaintext rows keep working unchanged, and empty stays empty', () => {
    process.env.SECRETS_ENC_KEY = key(1)
    expect(resolveWhatsappAccessToken('EAAG-legacy-plaintext')).toBe('EAAG-legacy-plaintext')
    expect(resolveWhatsappAccessToken(null)).toBe('')
    expect(resolveWhatsappAccessToken(undefined)).toBe('')
    expect(resolveWhatsappAccessToken('')).toBe('')
    expect(isSealedWhatsappAccessToken('EAAG-legacy-plaintext')).toBe(false)
  })

  it('trims what Meta returned before sealing', () => {
    process.env.SECRETS_ENC_KEY = key(1)
    expect(resolveWhatsappAccessToken(sealWhatsappAccessToken('  EAAG-x \n'))).toBe('EAAG-x')
  })

  it('refuses to seal an empty token or an already sealed value (that would send ciphertext to Meta)', () => {
    process.env.SECRETS_ENC_KEY = key(1)
    expect(() => sealWhatsappAccessToken('')).toThrow('empty_whatsapp_token')
    expect(() => sealWhatsappAccessToken('   ')).toThrow('empty_whatsapp_token')
    expect(() => sealWhatsappAccessToken(sealWhatsappAccessToken('EAAG-x'))).toThrow('whatsapp_token_already_sealed')
  })

  it('refuses to seal without a key, rather than writing plaintext', () => {
    delete process.env.SECRETS_ENC_KEY
    expect(() => sealWhatsappAccessToken('EAAG-x')).toThrow(/SECRETS_ENC_KEY/)
  })

  it('a seal that cannot be opened throws, never an empty token Meta would read as expired', () => {
    process.env.SECRETS_ENC_KEY = key(1)
    const sealed = sealWhatsappAccessToken('EAAG-x')
    process.env.SECRETS_ENC_KEY = key(2)
    expect(() => resolveWhatsappAccessToken(sealed)).toThrow()
  })

  it('a tampered seal is rejected by the authentication tag', () => {
    process.env.SECRETS_ENC_KEY = key(1)
    const sealed = sealWhatsappAccessToken('EAAG-x')
    const body = Buffer.from(sealed.slice(WHATSAPP_TOKEN_SEAL_PREFIX.length), 'base64')
    body[body.length - 1] ^= 0x01
    expect(() => resolveWhatsappAccessToken(WHATSAPP_TOKEN_SEAL_PREFIX + body.toString('base64'))).toThrow()
  })

  it('the error a failed open throws carries no token material', () => {
    process.env.SECRETS_ENC_KEY = key(1)
    const sealed = sealWhatsappAccessToken('EAAG-secret-material')
    process.env.SECRETS_ENC_KEY = key(2)
    try {
      resolveWhatsappAccessToken(sealed)
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('EAAG-secret-material')
      expect(String((err as Error).message)).not.toContain(sealed.slice(5, 25))
    }
  })
})
