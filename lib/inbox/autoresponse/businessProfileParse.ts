/**
 * The business profile's PURE half: its shape, its version, and reading one
 * back from the database.
 *
 * Split out of `businessProfile.ts`, which also derives a profile with a model
 * call. Anything that merely needs to READ a stored profile — the settings data
 * layer, and through it every caller of `getChannelSettings` — was importing
 * the AI router to do it. The deterministic questionnaire cannot afford that:
 * its guarantee is that no model is reachable from its module graph at all.
 *
 * Nothing here changed in behaviour; `businessProfile.ts` re-exports all of it.
 */
import { createHash } from 'crypto'

export const BUSINESS_PROFILE_VERSION = 1

export type BusinessProfile = {
  version: number
  /** Hash of the description this was derived from — detects staleness. */
  sourceHash: string
  derivedAt: string
  /** What the business is and does. Quotable. */
  facts: string[]
  /** Explicitly stated prices, hours and policies. Quotable verbatim. */
  explicit: { prices: string[]; hours: string[]; policies: string[] }
  /** What a good conversation should achieve. Goals, never capabilities. */
  objectives: string[]
  /** Details worth collecting, when the customer's need makes them relevant. */
  collect: string[]
  /** Tone preference, if the owner expressed one. */
  tone: string | null
  /** When to bring in a person, if the owner said. */
  handoff: string | null
  /** Anything the owner asked for that the agent cannot do — surfaced to the UI. */
  unsupportedRequests: string[]
}

export function hashDescription(text: string): string {
  return createHash('sha256').update((text ?? '').trim()).digest('hex').slice(0, 16)
}

/** True when the stored profile was derived from exactly this text. */
export function isProfileCurrent(profile: BusinessProfile | null, description: string | null): boolean {
  if (!profile || !description?.trim()) return false
  if (profile.version !== BUSINESS_PROFILE_VERSION) return false
  return profile.sourceHash === hashDescription(description)
}

export const clean = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0 && v.length <= 400).slice(0, 12)
    : []

export const cleanOne = (value: unknown): string | null => {
  const v = String(value ?? '').trim()
  return v && v.toLowerCase() !== 'null' && v.length <= 400 ? v : null
}

export function parseBusinessProfile(raw: unknown): BusinessProfile | null {
  if (!raw) return null
  try {
    const p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as BusinessProfile
    if (!p || typeof p !== 'object') return null
    if (p.version !== BUSINESS_PROFILE_VERSION) return null
    if (typeof p.sourceHash !== 'string') return null
    return {
      ...p,
      facts: clean(p.facts),
      explicit: {
        prices: clean(p.explicit?.prices),
        hours: clean(p.explicit?.hours),
        policies: clean(p.explicit?.policies),
      },
      objectives: clean(p.objectives),
      collect: clean(p.collect),
      tone: cleanOne(p.tone),
      handoff: cleanOne(p.handoff),
      unsupportedRequests: clean(p.unsupportedRequests),
    }
  } catch {
    return null
  }
}

/**
 * The profile as the agent reads it. Facts and behaviour are separated on the
 * page, because that separation is the entire reason for deriving a profile: a
 * model that cannot tell an objective from a fact will report the objective as
 * done.
 *
 * Empty sections are OMITTED rather than rendered empty. "מחירים: (אין)" is an
 * invitation; silence is not.
 */
export function formatBusinessProfileBlock(profile: BusinessProfile): string | null {
  const lines: string[] = []
  const section = (title: string, values: string[]) => {
    if (!values.length) return
    lines.push(title)
    for (const v of values) lines.push(`- ${v}`)
  }

  section('עובדות על העסק (מותר לצטט; זה כל מה שידוע לך):', profile.facts)
  section('מחירים שהעסק מסר במפורש (מותר לצטט כלשונם):', profile.explicit.prices)
  section('שעות ומועדי פעילות שהעסק מסר:', profile.explicit.hours)
  section('מדיניות שהעסק מסר:', profile.explicit.policies)

  if (profile.objectives.length) {
    lines.push('מה שהשיחה אמורה להשיג (מטרות, לא פעולות שאת/ה מבצע/ת):')
    for (const v of profile.objectives) lines.push(`- ${v}`)
  }
  section('פרטים שכדאי לברר מהלקוח, כשהם רלוונטיים לצורך שלו:', profile.collect)

  if (profile.tone) lines.push(`סגנון מבוקש: ${profile.tone}`)
  if (profile.handoff) lines.push(`מתי להעביר לאדם: ${profile.handoff}`)

  if (profile.unsupportedRequests.length) {
    lines.push('בעל/ת העסק ביקש/ה דברים שאת/ה לא יכול/ה לבצע. קדם/י אותם, אל תבצע/י ואל תדווח/י שבוצעו:')
    for (const v of profile.unsupportedRequests) lines.push(`- ${v}`)
  }

  return lines.length ? lines.join('\n') : null
}

/**
 * Everything quotable, flattened — the grounding corpus the validator checks a
 * price figure or a process claim against. Objectives are deliberately excluded:
 * "we book appointments" must never ground a booking claim.
 */
export function groundedFactsFromProfile(profile: BusinessProfile | null, fallback: string | null): string | null {
  if (!profile) return fallback
  const parts = [
    ...profile.facts,
    ...profile.explicit.prices,
    ...profile.explicit.hours,
    ...profile.explicit.policies,
  ]
  return parts.length ? parts.join('\n') : fallback
}
