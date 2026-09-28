/**
 * NO REAL CREDENTIAL MAY SIT IN A TRACKED `.env*example` FILE.
 *
 * This is not hypothetical hygiene. Three real keys — Anthropic, OpenAI and
 * Google — were committed to `.env.test.example` and stayed there until
 * 2026-09-08. All three are now dead, and Google said why in its own words when
 * probed: "Your API key was reported as leaked." That is a provider's secret
 * scanner finding a public repository, which is the failure this test exists to
 * catch BEFORE the scanner does.
 *
 * WHAT IT CHECKS. Example files are templates: every secret-shaped value must be
 * empty or an obvious placeholder. Detection is on the VALUE's shape, not the
 * key's name, because a name rule would miss `FOO_TOKEN=sk-ant-…` and a value
 * rule would not.
 *
 * WHAT IT CANNOT DO. Git history still holds anything ever committed; removing a
 * value from HEAD does not remove it from the past, and scrubbing history is a
 * destructive shared-branch operation. This test stops the NEXT one.
 *
 * It never prints a matched value — a failure that leaked the secret into CI
 * logs would defeat its own purpose. It reports file, line and key name.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

/**
 * Known provider key shapes, plus a generic high-entropy fallback.
 *
 * The prefixes are the load-bearing half: they are what provider scanners match
 * on and they carry no false positives. The entropy rule catches an unknown
 * provider's format, at the cost of needing the placeholder allowance below.
 */
const CREDENTIAL_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Anthropic', re: /^sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI', re: /^sk-(proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'Google', re: /^AIza[A-Za-z0-9_-]{30,}/ },
  { name: 'AWS access key', re: /^A(KIA|SIA)[A-Z0-9]{16}/ },
  { name: 'GitHub', re: /^gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Slack', re: /^xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe', re: /^[rs]k_(live|test)_[A-Za-z0-9]{20,}/ },
  { name: 'private key block', re: /^-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // Long, mixed-case, high-entropy, and not obviously a placeholder.
  { name: 'high-entropy value', re: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9+/_-]{40,}={0,2}$/ },
]

/**
 * A value that is visibly a template rather than a secret.
 *
 * Covers `xxxx…`, `change_me`, `your-key-here`, `<paste>`, and this repo's own
 * `test_*_secret_xxxx` convention. Deliberately generous: a placeholder wrongly
 * flagged is noise, and noise gets a test disabled, which is worse than the gap.
 */
const PLACEHOLDER = /(^$|x{4,}|change[_-]?me|your[_-]|example|placeholder|dummy|fake|test[_-]|sample|^<.*>$|^\.\.\.$)/i

function exampleFiles(): string[] {
  return readdirSync(ROOT)
    .filter((f) => f.startsWith('.env') && /example|sample|template/i.test(f))
    .map((f) => join(ROOT, f))
}

type Finding = { file: string; line: number; key: string; pattern: string }

function scan(path: string): Finding[] {
  const findings: Finding[] = []
  readFileSync(path, 'utf-8')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) return
      const eq = line.indexOf('=')
      if (eq === -1) return
      const key = line.slice(0, eq).trim()
      // Strip surrounding quotes; a quoted secret is still a secret.
      const value = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (PLACEHOLDER.test(value)) return
      const hit = CREDENTIAL_PATTERNS.find((p) => p.re.test(value))
      if (hit) findings.push({ file: path.replace(ROOT + '/', ''), line: i + 1, key, pattern: hit.name })
    })
  return findings
}

describe('tracked env example files carry no real credentials', () => {
  it('finds the example files it is meant to guard', () => {
    // A rename that silently disabled this test is the one failure it could not
    // otherwise see: zero files scanned would pass the check below vacuously.
    const files = exampleFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(files.some((f) => f.endsWith('.env.test.example'))).toBe(true)
  })

  it('has no credential-shaped value in any of them', () => {
    const findings = exampleFiles().flatMap(scan)
    // Names the location and the provider, NEVER the value.
    const message = findings.map((f) => `${f.file}:${f.line} ${f.key} looks like a ${f.pattern} credential`).join('\n')
    expect(message).toBe('')
  })
})

describe('the detector itself', () => {
  const detect = (value: string) => !PLACEHOLDER.test(value) && CREDENTIAL_PATTERNS.some((p) => p.re.test(value))

  it('catches the three shapes that were actually committed here', () => {
    expect(detect('sk-ant-api03-A1b2C3d4E5f6G7h8I9j0KLmnOPqrST')).toBe(true)
    expect(detect('sk-proj-A1b2C3d4E5f6G7h8I9j0KLmnOPqrST')).toBe(true)
    expect(detect('AIzaA1b2C3d4E5f6G7h8I9j0KLmnOPqrSTuv')).toBe(true)
  })

  it('catches other common provider shapes', () => {
    expect(detect('ghp_A1b2C3d4E5f6G7h8I9j0KLmnOPqrST')).toBe(true)
    expect(detect('AKIAABCDEFGHIJKLMNOP')).toBe(true)
    expect(detect('sk_live_A1b2C3d4E5f6G7h8I9j0')).toBe(true)
  })

  it('leaves placeholders and ordinary config alone', () => {
    for (const ok of [
      '',
      'test_jwt_secret_change_me_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'your-api-key-here',
      '<paste-key>',
      'claude-sonnet-4-6',
      'postgres://test:test@localhost:5432/test_db',
      'https://pay.grow.link/test-link-id',
      'localhost:3000',
      'true',
      'all',
    ]) {
      expect(detect(ok), ok).toBe(false)
    }
  })
})
