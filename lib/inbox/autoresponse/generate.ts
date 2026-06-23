/**
 * Instant Response Engine — AI generation (Phase 1). Produces ONE short Hebrew
 * acknowledgment: greet + acknowledge + exactly one simple qualification
 * question, 1–3 sentences. Reuses the existing runStructured router (allowlist +
 * daily USD cap enforced there). The output still passes the deterministic
 * validator (validate.ts) before sending — this prompt is the first line of
 * defense, not the last.
 */
import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'

export type GenerateResult =
  | { ok: true; message: string }
  | { ok: false; skipReason: 'ai_unavailable' | 'budget_exhausted' }

const AutoResponseSchema = z.object({
  message: z.string().describe('הודעת הפתיחה לליד, 1-3 משפטים, עם שאלת הבהרה אחת'),
})

const SYSTEM = [
  'אתה כותב הודעת פתיחה קצרה בשם העסק לליד חדש שכתב בוואטסאפ.',
  'ההודעה חייבת: לברך, לאשר שקיבלנו את הפנייה, ולשאול שאלת הבהרה אחת פשוטה.',
  'אורך: בדיוק 1 עד 3 משפטים. שאלה אחת בלבד.',
  'אסור בתכלית האיסור: לנקוב במחיר, בעלות, בהנחה, בזמינות, במועד, בתור או בפגישה; להבטיח או להתחייב לכל דבר; להמציא עובדה כלשהי על העסק.',
  'אם חסר לך מידע — שאל, אל תמציא. אל תכתוב מספרים.',
  'כתוב בעברית, בגוף ראשון רבים, בנימה מקצועית וחמה. החזר אך ורק את ההודעה בשדה message.',
].join('\n')

function buildUser(args: { customerName: string | null; lastCustomerMessage: string; guidance: string | null }): string {
  const lines = [
    args.customerName ? `שם הליד: ${args.customerName}` : 'שם הליד: לא ידוע',
    `ההודעה שהליד שלח: ${args.lastCustomerMessage || '(ללא טקסט)'}`,
  ]
  // guidance is business CONTEXT for tone/topic only — never facts to quote/commit to.
  if (args.guidance) lines.push(`הקשר עסקי (לרקע בלבד, לא לציטוט כעובדה): ${args.guidance}`)
  return lines.join('\n')
}

export async function generateAcknowledgement(args: {
  agencyId: number
  customerName: string | null
  lastCustomerMessage: string
  guidance: string | null
}): Promise<GenerateResult> {
  const out = await runStructured({
    kind: 'inbox.autoResponse',
    schema: AutoResponseSchema,
    schemaName: 'AutoResponseMessage',
    system: SYSTEM,
    user: buildUser(args),
    agencyId: args.agencyId,
  })

  if (out.ok === false) {
    return { ok: false, skipReason: out.reason === 'over-quota' ? 'budget_exhausted' : 'ai_unavailable' }
  }
  const data = out.data as { message: string }
  return { ok: true, message: data.message }
}
