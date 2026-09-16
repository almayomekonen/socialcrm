/**
 * The owner writes one paragraph. This turns it into configuration.
 *
 * WHY DERIVE AT ALL, RATHER THAN HAND THE PARAGRAPH TO THE AGENT. A paragraph
 * mixes three things that must not be mixed: facts the agent may quote ("open
 * Sun–Thu 8:00–17:00"), goals for the conversation ("find out what is wrong with
 * the car"), and details to collect ("model and year"). Left as prose, the model
 * decides per turn which sentence is which, and a goal reads as a fact —
 * "we book appointments" becomes "I have booked you".
 *
 * WHEN. Once, on save. Never per customer message: it would add a model call and
 * a failure mode to every inbound, and produce a profile that quietly drifts
 * between turns.
 *
 * THE ORIGINAL TEXT REMAINS THE SOURCE OF TRUTH. `guidance` is what the owner
 * typed and what they edit; this is a cached, machine-readable view of it. A
 * failed derivation is therefore always retryable from the original words, and
 * a stale profile is detectable by comparing `sourceHash`.
 *
 * THE ONE RULE OF DERIVATION: transcribe, never enrich. Nothing may appear in
 * the profile that is not in the owner's text. A garage that did not mention
 * prices gets no prices — not "competitive pricing", not an empty-but-present
 * price section that invites the model to fill it in.
 */
import { createHash } from 'crypto'
import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'

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

const ProfileSchema = z.object({
  facts: z.array(z.string()).describe('מה העסק הוא ומה הוא עושה, כפי שנכתב. בלי להוסיף'),
  prices: z.array(z.string()).describe('מחירים שנכתבו במפורש בלבד. ריק אם לא נכתבו'),
  hours: z.array(z.string()).describe('שעות או ימי פעילות שנכתבו במפורש בלבד. ריק אם לא נכתבו'),
  policies: z.array(z.string()).describe('מדיניות שנכתבה במפורש (ביטול, תשלום, הגעה). ריק אם לא נכתבה'),
  objectives: z.array(z.string()).describe('מה בעל/ת העסק רוצה שהשיחה תשיג'),
  collect: z.array(z.string()).describe('פרטים שכדאי לאסוף מהלקוח, לפי מה שנכתב'),
  tone: z.string().nullable().describe('העדפת סגנון אם נכתבה. null אם לא'),
  handoff: z.string().nullable().describe('מתי להעביר לאדם, אם נכתב. null אם לא'),
  unsupportedRequests: z
    .array(z.string())
    .describe('דברים שבעל/ת העסק ביקש/ה שהסוכן אינו יכול לבצע בפועל: לקבוע תור, לגבות תשלום, לשלוח קובץ או קישור, לעדכן מערכת'),
})

const SYSTEM = [
  'את/ה ממיר/ה תיאור חופשי של עסק להגדרות מובנות לסוכן שיחה בוואטסאפ.',
  'חוק יחיד וקובע: העתק/י בלבד. אסור להוסיף, להסיק, להשלים או "לשפר" שום פרט שלא נכתב.',
  'אם בעל/ת העסק לא כתב/ה מחירים — prices ריק. לא "מחירים תחרותיים", לא "לפי הצעת מחיר". ריק.',
  'אם לא נכתבו שעות — hours ריק. אם לא נכתבה מדיניות — policies ריק.',
  'אל תמציא/י שירותים, יכולות, אינטגרציות, אחריות או התחייבויות.',
  'facts: מה העסק הוא ועושה, במילים של בעל/ת העסק עד כמה שאפשר.',
  'objectives: מה בעל/ת העסק רוצה שהשיחה תשיג. זו מטרה, לא יכולת טכנית.',
  'collect: פרטים שכדאי לברר מהלקוח.',
  'unsupportedRequests: אם נכתב שהסוכן "יקבע תור", "ישלח הצעת מחיר", "יגבה תשלום", "יעדכן במערכת" או כל פעולה שדורשת ביצוע בעולם — רשום/רשמי אותה כאן. אלה מטרות שהסוכן יכול לקדם אך לא לבצע.',
  'שדה שאין לו מקור בטקסט: מערך ריק או null. לעולם לא ניחוש.',
].join('\n')

export type DeriveResult =
  | { ok: true; profile: BusinessProfile }
  | { ok: false; reason: 'ai_unavailable' | 'budget_exhausted' | 'empty_description' }

const clean = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0 && v.length <= 400).slice(0, 12)
    : []

const cleanOne = (value: unknown): string | null => {
  const v = String(value ?? '').trim()
  return v && v.toLowerCase() !== 'null' && v.length <= 400 ? v : null
}

export async function deriveBusinessProfile(args: {
  agencyId: number
  description: string
  businessName?: string | null
}): Promise<DeriveResult> {
  const description = (args.description ?? '').trim()
  if (!description) return { ok: false, reason: 'empty_description' }

  const user = [
    args.businessName ? `שם העסק: ${args.businessName}` : 'שם העסק: (לא סופק)',
    '',
    'התיאור שבעל/ת העסק כתב/ה:',
    description,
  ].join('\n')

  const out = await runStructured({
    kind: 'inbox.autoResponse',
    schema: ProfileSchema,
    schemaName: 'BusinessProfile',
    system: SYSTEM,
    user,
    agencyId: args.agencyId,
  })

  if (out.ok === false) {
    return { ok: false, reason: out.reason === 'over-quota' ? 'budget_exhausted' : 'ai_unavailable' }
  }

  const d = out.data as z.infer<typeof ProfileSchema>
  return {
    ok: true,
    profile: {
      version: BUSINESS_PROFILE_VERSION,
      sourceHash: hashDescription(description),
      derivedAt: new Date().toISOString(),
      facts: clean(d.facts),
      explicit: { prices: clean(d.prices), hours: clean(d.hours), policies: clean(d.policies) },
      objectives: clean(d.objectives),
      collect: clean(d.collect),
      tone: cleanOne(d.tone),
      handoff: cleanOne(d.handoff),
      unsupportedRequests: clean(d.unsupportedRequests),
    },
  }
}

/** Defensive read: a column written by an older version is treated as absent. */
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
