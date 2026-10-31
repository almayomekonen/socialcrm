import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIRST_RUN_COPY, FIRST_LEAD_MOBILE } from '@/lib/activation/firstRunCopy'

/**
 * THE SEMANTIC RULE, not a banned string.
 *
 * `activationCopy.test.ts` already forbids the exact phrase "החשבון שלך מוכן".
 * That guard was too narrow to hold: the phrase went away and its MEANING moved
 * to the highest-traffic first-run surfaces instead. A new user was told they
 * were "ready" three times — the welcome modal ("ה־SocialCRM Pro שלך מוכן"), the
 * activation screen, and the trial subtitle — before owning a single ליד.
 *
 * Every one of those sentences was literally true and none was true about the
 * thing the user came for. That is the false finish line, and a string
 * allowlist cannot catch it, because the next author will simply pick different
 * words for the same claim.
 *
 * THE RULE: a surface shown while the agency has zero לידים may not assert that
 * anything is ready, complete, or finished. It may say what is OPEN, and it must
 * say what to do next.
 */

/** Readiness / completion claims, in the forms Hebrew actually uses. */
const READINESS = /(מוכן|מוכנה|מוכנים|הושלם|הושלמה|הסתיים|סיימת|הכול מסודר|הכל מסודר)/
/** `ux-guidelines.md` §6 — leads are never customers, and never insurance agents. */
const BANNED_TERMS = /(לקוח|לקוחות|סוכן|סוכנים|עסקה)/
/** `CLAUDE.md` §12 — no emoji in product UI. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

/** Walk a copy object and yield every string it can render. */
function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  // Count-formatters are real rendered copy too; sample them at 1 and 2 so a
  // banned word hiding in a plural branch cannot slip through.
  if (typeof value === 'function') {
    const fn = value as (n: number) => string
    try {
      return [
        [`${path}(1)`, String(fn(1))],
        [`${path}(2)`, String(fn(2))],
      ]
    } catch {
      return []
    }
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  }
  return []
}

const firstRunStrings = [...strings(FIRST_RUN_COPY, 'FIRST_RUN_COPY'), ...strings(FIRST_LEAD_MOBILE, 'FIRST_LEAD_MOBILE')]

describe('first-run copy — no readiness claim before the user has לידים', () => {
  it('has strings to check (guards against the walker silently finding nothing)', () => {
    expect(firstRunStrings.length).toBeGreaterThan(20)
  })

  it('never claims the account/workspace/plan is ready or complete', () => {
    const offenders = firstRunStrings.filter(([, s]) => READINESS.test(s))
    expect(offenders, `readiness claim in: ${offenders.map(([p, s]) => `${p} = "${s}"`).join(' | ')}`).toEqual([])
  })

  it('never uses banned terminology', () => {
    const offenders = firstRunStrings.filter(([, s]) => BANNED_TERMS.test(s))
    expect(offenders, `banned term in: ${offenders.map(([p, s]) => `${p} = "${s}"`).join(' | ')}`).toEqual([])
  })

  it('never uses emoji', () => {
    const offenders = firstRunStrings.filter(([, s]) => EMOJI.test(s))
    expect(offenders, `emoji in: ${offenders.map(([p]) => p).join(' | ')}`).toEqual([])
  })

  it('states what is open and what to do, not that something is finished', () => {
    expect(FIRST_RUN_COPY.headline).toMatch(/פתוחה|פתוח/)
  })
})

/**
 * The welcome modal is the FIRST first-run surface a new agency sees — 19 of 19
 * agencies in production have seen it — and it is non-dismissible, so its
 * headline is the single most-read sentence in onboarding. It is asserted here
 * as source text because the component is a client component with its own
 * dialog/portal machinery; the claim under test is the copy, not the render.
 */
describe('welcome trial modal — the highest-traffic first-run surface', () => {
  // The headline / sentence table moved to welcomeTrialCopy.ts (i18n Phase F5 refactor); both are read.
  const source = ['components/trial/WelcomeTrialModal.tsx', 'components/trial/welcomeTrialCopy.ts']
    .map((f) => readFileSync(join(process.cwd(), f), 'utf8'))
    .join('\n')
  /** Only the visible copy: JSX text and quoted title/sub strings. */
  const visible = source.match(/[^\n]*['>][^<'"]*[֐-׿][^<'"]*/g) ?? []

  it('does not tell a user with zero לידים that anything of theirs is ready', () => {
    const offenders = visible.filter((line) => READINESS.test(line))
    expect(offenders, `readiness claim in WelcomeTrialModal: ${offenders.join(' | ')}`).toEqual([])
  })
})
