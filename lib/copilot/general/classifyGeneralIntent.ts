import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'
import { GENERAL_HIGH_CONFIDENCE } from './constants'
import { BRIEFING_EXAMPLES, BRIEFING_INTENT_IDS, type GeneralIntentId } from './registry'
import { GUIDE_ENTRIES } from './guideMap'

export type Classification = { intent: GeneralIntentId; confidence: number }

const ALL_IDS: string[] = [...BRIEFING_INTENT_IDS, ...GUIDE_ENTRIES.map((g) => g.id)]
const INTENT_ENUM = [...ALL_IDS, 'unknown'] as unknown as [string, ...string[]]

/** Cheap deterministic pass: substring match against the authored examples. */
export function quickClassifyGeneral(text: string): Classification {
  const t = text.trim()
  for (const g of GUIDE_ENTRIES) {
    if (g.examples.some((e) => t.includes(e))) return { intent: g.id as GeneralIntentId, confidence: 0.95 }
  }
  for (const id of BRIEFING_INTENT_IDS) {
    if (BRIEFING_EXAMPLES[id].some((e) => t.includes(e))) return { intent: id, confidence: 0.95 }
  }
  return { intent: 'unknown', confidence: 0 }
}

/**
 * Closed-world classify: the quick pass first, else a constrained LLM choice
 * limited to the fixed id list (or 'unknown'). The model can ONLY pick an
 * existing id — it never invents a capability. On any model failure we return
 * 'unknown', which routes to the capability menu (never a guess).
 */
export async function classifyGeneralIntent(text: string, agencyId: number): Promise<Classification> {
  const quick = quickClassifyGeneral(text)
  if (quick.confidence >= GENERAL_HIGH_CONFIDENCE) return quick

  const out = await runStructured({
    kind: 'copilot.classifyIntent',
    schema: z.object({
      intent: z.enum(INTENT_ENUM),
      confidence: z.number().min(0).max(1),
    }),
    schemaName: 'GeneralIntent',
    system:
      'סווג את הודעת הנציג לאחת מהקטגוריות הסגורות בלבד. ' +
      'אם אינך בטוח או שאין התאמה — החזר "unknown". אל תמציא קטגוריה.',
    user: `קטגוריות: ${ALL_IDS.join(', ')}\nהודעה: ${text}`,
    agencyId,
    roleOverride: 'volume',
  })
  if (!out.ok) return { intent: 'unknown', confidence: 0 }
  return { intent: out.data.intent as GeneralIntentId, confidence: out.data.confidence }
}
