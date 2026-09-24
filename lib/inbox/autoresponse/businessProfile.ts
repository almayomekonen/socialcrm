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
import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'

import {
  BUSINESS_PROFILE_VERSION,
  clean,
  cleanOne,
  formatBusinessProfileBlock,
  groundedFactsFromProfile,
  hashDescription,
  isProfileCurrent,
  parseBusinessProfile,
  type BusinessProfile,
} from './businessProfileParse'

/**
 * The pure half lives in `businessProfileParse.ts` so that reading a stored
 * profile does not require importing this module, and with it the AI router.
 * Re-exported here so every existing importer is untouched.
 */
export {
  BUSINESS_PROFILE_VERSION,
  formatBusinessProfileBlock,
  groundedFactsFromProfile,
  hashDescription,
  isProfileCurrent,
  parseBusinessProfile,
}
export type { BusinessProfile }

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
  'שם העסק נמסר לך רק כהקשר. אסור להכניס אותו ל-facts ואסור לכתוב שורה בסגנון "שם העסק: ...". הוא כבר ידוע למערכת בנפרד.',
  'objectives: מה בעל/ת העסק רוצה שהשיחה תשיג. זו מטרה, לא יכולת טכנית.',
  'collect: פרטים שכדאי לברר מהלקוח.',
  'unsupportedRequests: אם נכתב שהסוכן "יקבע תור", "ישלח הצעת מחיר", "יגבה תשלום", "יעדכן במערכת" או כל פעולה שדורשת ביצוע בעולם — רשום/רשמי אותה כאן. אלה מטרות שהסוכן יכול לקדם אך לא לבצע.',
  'שדה שאין לו מקור בטקסט: מערך ריק או null. לעולם לא ניחוש.',
].join('\n')

export type DeriveResult =
  | { ok: true; profile: BusinessProfile }
  | { ok: false; reason: 'ai_unavailable' | 'budget_exhausted' | 'empty_description' }

export async function deriveBusinessProfile(args: {
  agencyId: number
  description: string
  businessName?: string | null
}): Promise<DeriveResult> {
  const description = (args.description ?? '').trim()
  if (!description) return { ok: false, reason: 'empty_description' }

  // The name is context, not content. An earlier version put it on its own
  // "שם העסק: X" line immediately above the description, and the model
  // transcribed that line straight into `facts` — so a profile could assert a
  // business name that contradicted the description. It is now clearly labelled
  // as out-of-band, and the system prompt forbids copying it.
  const user = [
    args.businessName
      ? `(הקשר בלבד, לא להעתיק ולא להכניס ל-facts) העסק נקרא: ${args.businessName}`
      : '(הקשר בלבד) שם העסק לא סופק.',
    '',
    'התיאור שבעל/ת העסק כתב/ה, וממנו בלבד יש לחלץ:',
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
