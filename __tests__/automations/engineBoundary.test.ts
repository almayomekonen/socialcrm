import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * ENGINE BOUNDARY — the B6b counterpart to `builderBoundary.test.ts`.
 *
 * Law 1 keeps integrations out of the Builder. This keeps CHANNELS out of the
 * engine: the worker, the law layer and the emission path must not name a
 * delivery mechanism, because the moment one of them does, adding the next
 * action stops being "a catalog entry and an executor".
 *
 * Architectures do not decay by decision; they decay by a hundred small
 * exceptions nobody reviewed. So the exemptions below are ENUMERATED, JUSTIFIED
 * and COUNTED, and a test asserts the count never grows.
 */

const ROOT = process.cwd()

/** The files that decide what happens, as opposed to the files that do it. */
const ENGINE_FILES = [
  'lib/automations/worker.ts',
  'lib/automations/laws.ts',
  'lib/automations/emit.ts',
  'lib/automations/actionEntry.ts',
  'lib/automations/conditionEvaluator.ts',
  'lib/automations/executors/types.ts',
  'lib/automations/executors/registry.ts',
]

/** Words that name a channel or a channel's machinery. */
const CHANNEL_WORDS = [
  'sendEmail',
  'renderAutomationEmail',
  'resolveSenderIdentity',
  'unsubscribe',
  'replyTo',
  'mailer',
  'transport',
  'sms',
  'whatsapp',
  'resend',
]

/**
 * EXEMPTIONS — each one justified, each one a persisted-vocabulary map rather
 * than a branch. THIS LIST MAY ONLY SHRINK.
 *
 *   laws.ts · `email:` / `phone:` — MISSING_RECIPIENT maps a field TYPE to the
 *   persisted skip reason for "there is no recipient of that type". The reasons
 *   are append-only persisted values (`no_email`, `no_phone`), so the map has
 *   to name them; it is the same class of thing as `engineBridge.ts`, and it
 *   contains no behaviour.
 *
 *   executors/registry.ts · `email` — the registry is the ONE file whose job is
 *   to name what is installed, exactly as `connectors/registry.ts` names its
 *   providers. "Executor registration" is half of B6b's acceptance criterion;
 *   banning the name here would ban the registration.
 */
const EXEMPT: { file: string; word: string; why: string }[] = [
  { file: 'lib/automations/laws.ts', word: 'email', why: 'MISSING_RECIPIENT vocabulary map' },
  { file: 'lib/automations/laws.ts', word: 'phone', why: 'MISSING_RECIPIENT vocabulary map' },
  { file: 'lib/automations/executors/registry.ts', word: 'email', why: 'the installed-executor list' },
]
const EXEMPT_COUNT = EXEMPT.length

/** Strips comments — documentation may name a channel; code may not. */
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const exempt = (file: string, word: string) => EXEMPT.some((e) => e.file === file && e.word === word)

describe('the engine names no delivery channel', () => {
  it('every engine file exists (a renamed file must not silently escape the guard)', () => {
    for (const file of ENGINE_FILES) {
      expect(fs.existsSync(path.join(ROOT, file)), `${file} is guarded but missing`).toBe(true)
    }
  })

  it('no engine file mentions a channel or its machinery', () => {
    const violations: string[] = []
    for (const file of ENGINE_FILES) {
      const code = read(file)
      for (const word of CHANNEL_WORDS) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(code)) violations.push(`${file} → ${word}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('`email` and `phone` appear only where an exemption says they may', () => {
    const violations: string[] = []
    for (const file of ENGINE_FILES) {
      const code = read(file)
      for (const word of ['email', 'phone']) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(code) && !exempt(file, word)) {
          violations.push(`${file} → ${word}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('the worker names no channel at all — not even an exempt one', () => {
    const code = read('lib/automations/worker.ts')
    for (const word of [...CHANNEL_WORDS, 'email', 'phone']) {
      expect(new RegExp(`\\b${word}\\b`, 'i').test(code), `worker.ts names "${word}"`).toBe(false)
    }
  })
})

describe('the registry names only what is installed — nothing more', () => {
  it('contains no branch, no channel machinery and no behaviour', () => {
    const code = read('lib/automations/executors/registry.ts')
    for (const pattern of [/\bif\s*\(/, /\bswitch\s*\(/, /\bawait\b/, /\bfetch\b/]) {
      expect(pattern.test(code), `registry.ts contains ${String(pattern)}`).toBe(false)
    }
  })
})

describe('exemptions may only shrink', () => {
  it('the list has not grown', () => {
    expect(EXEMPT.length).toBeLessThanOrEqual(EXEMPT_COUNT)
  })

  it('every exemption is still needed — a stale one is deleted, not kept', () => {
    for (const { file, word, why } of EXEMPT) {
      const code = read(file)
      expect(new RegExp(`\\b${word}\\b`, 'i').test(code), `${file} no longer needs "${word}" (${why})`).toBe(true)
    }
  })
})

describe('the guard actually catches violations', () => {
  it('detects a channel word in a synthetic engine file', () => {
    const synthetic = `const res = await deps.sendEmail({ to })`
    expect(CHANNEL_WORDS.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(codeOnly(synthetic)))).toBe(true)
  })

  it('does NOT flag a channel word inside a comment', () => {
    const synthetic = `// the transport is the executor's business\nconst x = 1`
    expect(/\btransport\b/i.test(codeOnly(synthetic))).toBe(false)
  })
})
