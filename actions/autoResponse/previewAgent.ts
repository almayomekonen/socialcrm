'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { db } from '@/config/db'
import { getChannelSettings } from '@/db/autoResponseSettings'
import {
  generateQualifyTurn,
  detectLang,
  deterministicQualifyFallback,
  detectOptOut,
  handoffMessage,
} from '@/lib/inbox/autoresponse/qualify'
import { classifySalesTurnFromTranscript, detectHumanRequest } from '@/lib/inbox/autoresponse/salesIntent'
import { decideConversationControl, conversationCloser } from '@/lib/inbox/autoresponse/conversationControl'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { decideGreeting, withGreeting } from '@/lib/inbox/autoresponse/greeting'
import { safeFallbackReply } from '@/lib/inbox/autoresponse/safeFallback'
import { classifyResponseProfile } from '@/lib/inbox/autoresponse/responseProfile'
import {
  formatBusinessIdentityBlock,
  groundedFactsFor,
  type BusinessIdentity,
} from '@/lib/inbox/autoresponse/businessIdentity'
import { isOwnBusinessAccount } from '@/lib/inbox/autoresponse/ownBusinessAccount'
import { deriveBusinessProfile, hashDescription, type BusinessProfile } from '@/lib/inbox/autoresponse/businessProfile'
import { mergeQualification, type Qualification } from '@/lib/inbox/autoresponse/qualification'

/**
 * "בדקו את הסוכן שלכם" — the owner talks to their own agent before any customer
 * does.
 *
 * ISOLATION IS THE POINT. This runs the SAME prompt construction, greeting
 * decision, control policy and validator the live agent runs, and then stops.
 * It performs no WhatsApp send, writes no conversation, message, lead, job,
 * notification or AI state, and can never trigger a real handoff. The entire
 * conversation lives in the caller's React state and is passed in on every
 * request; nothing about it is persisted anywhere.
 *
 * Actions the agent cannot really perform are already refused by the shared
 * capability block, so a preview reply that says "someone will get back to you"
 * is simulated in exactly the way the real one would be — the difference is only
 * that no person is actually notified, which the UI states plainly.
 *
 * DRAFT VS SAVED. The owner can test text they have not saved yet. When a draft
 * description is supplied it is derived on the fly; otherwise the saved profile
 * is used. The result reports which, so the UI can say so.
 */

export type PreviewTurn = { direction: 'inbound' | 'outbound'; text: string }

export type PreviewAgentInput = {
  transcript: PreviewTurn[]
  /** Unsaved description to test. Omitted ⇒ test the saved configuration. */
  draftDescription?: string | null
  draftAgentInstructions?: string | null
}

export type PreviewAgentResult =
  | {
      ok: true
      reply: string
      /** True when the reply came from unsaved text rather than saved settings. */
      usedDraft: boolean
      /** Whether a structured profile backed this turn. */
      profileDerived: boolean
      /** Transparency for the owner: what the engine decided this turn. */
      trace: {
        greeted: boolean
        language: 'he' | 'en'
        salesMove: string | null
        control: string
        validator: 'ok' | string
        simulated: string | null
      }
    }
  | { ok: false; reason: string }

const MAX_PREVIEW_TURNS = 60
const MAX_PREVIEW_TEXT = 1500

/** In-memory identity for the preview. Never written back. */
async function previewIdentity(
  agencyId: number,
  input: PreviewAgentInput,
): Promise<{ identity: BusinessIdentity; usedDraft: boolean; derivedNow: boolean }> {
  const settings = await getChannelSettings(agencyId, 'whatsapp')
  const agency = await db('agencies').where({ id: agencyId }).first('id', 'name')
  const name = typeof agency?.name === 'string' && agency.name.trim() ? agency.name.trim() : null

  const draft = (input.draftDescription ?? '').trim()
  const savedGuidance = settings?.guidance ?? null
  const usedDraft = Boolean(draft) && draft !== (savedGuidance ?? '')

  const guidance = usedDraft ? draft : savedGuidance
  const agentInstructions = usedDraft
    ? ((input.draftAgentInstructions ?? '').trim() || null)
    : (settings?.agentInstructions ?? null)

  let profile: BusinessProfile | null = settings?.businessProfile ?? null
  let derivedNow = false
  if (usedDraft && guidance) {
    const derived = await deriveBusinessProfile({ agencyId, description: guidance, businessName: name })
    profile = derived.ok ? derived.profile : null
    derivedNow = derived.ok
  } else if (profile && guidance && profile.sourceHash !== hashDescription(guidance)) {
    profile = null
  }

  return {
    identity: { agencyId, name, guidance, agentInstructions, isOwnProductBusiness: isOwnBusinessAccount(agencyId), profile },
    usedDraft,
    derivedNow,
  }
}

export async function previewAgentTurn(input: PreviewAgentInput): Promise<PreviewAgentResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }

  const transcript = (input.transcript ?? [])
    .slice(-MAX_PREVIEW_TURNS)
    .map((t) => ({ direction: t.direction, text: String(t.text ?? '').slice(0, MAX_PREVIEW_TEXT) }))
    .filter((t) => t.text.trim())
  if (!transcript.length) return { ok: false, reason: 'empty_transcript' }
  if (transcript[transcript.length - 1].direction !== 'inbound') return { ok: false, reason: 'no_pending_inbound' }

  const { identity, usedDraft, derivedNow } = await previewIdentity(user.agencyId, input)
  if (!identity.guidance) return { ok: false, reason: 'no_description' }

  const lastInbound = transcript[transcript.length - 1].text
  const lang = detectLang(lastInbound)

  // ── Opt-out and human request: the same deterministic checks as production ──
  if (detectOptOut(lastInbound)) {
    return {
      ok: true,
      reply: '',
      usedDraft,
      profileDerived: Boolean(identity.profile),
      trace: {
        greeted: false,
        language: lang,
        salesMove: null,
        control: 'OPT_OUT',
        validator: 'ok',
        simulated: 'הלקוח ביקש להפסיק. בשיחה אמיתית הסוכן היה נעצר לחלוטין ולא נשלחת הודעה.',
      },
    }
  }

  // The agent has spoken iff the preview transcript already contains an outbound.
  const hasPriorOutbound = transcript.some((t) => t.direction === 'outbound')
  const greeting = decideGreeting({ hasPriorOutbound, aiTurnCount: hasPriorOutbound ? 1 : 0, businessName: identity.name, lang, aiState: 'new' })
  const greetingLine = greeting.greet ? greeting.line : null

  if (detectHumanRequest(lastInbound, { previousOutbound: [...transcript].reverse().find((t) => t.direction === 'outbound')?.text })) {
    return {
      ok: true,
      reply: withGreeting(greetingLine, handoffMessage('human_request', lang)),
      usedDraft,
      profileDerived: Boolean(identity.profile),
      trace: {
        greeted: Boolean(greetingLine),
        language: lang,
        salesMove: 'HANDOFF_REQUEST',
        control: 'HANDOFF_TO_HUMAN',
        validator: 'ok',
        simulated: 'בשיחה אמיתית השיחה הייתה מועברת לצוות וסומנה כמטופלת על ידי אדם. כאן לא נשלחה התראה לאף אחד.',
      },
    }
  }

  const classified = classifySalesTurnFromTranscript(transcript)
  const previousOutbound = [...transcript].reverse().find((t) => t.direction === 'outbound')?.text ?? ''
  const control = decideConversationControl({
    salesMove: classified.salesMove,
    inboundText: lastInbound,
    previousOutbound,
  })

  if (control.action === 'CLOSE_CONVERSATION') {
    return {
      ok: true,
      reply: control.send === 'closer' ? conversationCloser(lang) : '',
      usedDraft,
      profileDerived: Boolean(identity.profile),
      trace: {
        greeted: false,
        language: lang,
        salesMove: classified.salesMove,
        control: `CLOSE_${control.reason}`,
        validator: 'ok',
        simulated: control.send === 'silence' ? 'בשיחה אמיתית הסוכן היה שותק כאן ומסמן את השיחה כסגורה.' : null,
      },
    }
  }

  // ── Generate, exactly as the worker does ───────────────────────────────────
  const businessIdentityBlock = formatBusinessIdentityBlock(identity)
  const groundedFacts = groundedFactsFor(identity)
  const questionPolicy = questionPolicyForSalesMove(classified.salesMove)
  const validateOpts = { questionPolicy, greetingTurn: Boolean(greetingLine), groundedFacts }

  // Facts the customer stated, accumulated the same way production does, so the
  // preview stops re-asking within a session.
  let qualification: Qualification = {}

  const gen = await generateQualifyTurn({
    agencyId: user.agencyId,
    transcript,
    qualification,
    collectFields: { required: [], optional: [] },
    guidance: identity.guidance,
    businessIdentityBlock,
    productKnowledgeBlock: null,
    salesMove: classified.salesMove,
    salesStrategy: classified.salesStrategy,
    greetingLine,
    responseProfile: classifyResponseProfile({
      lastInbound,
      recentCustomerTexts: transcript.filter((t) => t.direction === 'inbound').map((t) => t.text).slice(-3),
    }),
    bypassAllowlist: true,
  })

  if (gen.ok === false) {
    return { ok: false, reason: gen.skipReason }
  }

  qualification = mergeQualification(qualification, gen.extracted, { corrected: gen.corrected })

  let reply = gen.reply
  let validator: 'ok' | string = 'ok'
  const validation = validateAutoResponse(reply, validateOpts)
  if (!validation.ok) {
    validator = 'violation' in validation ? validation.violation : 'invalid'
    const repaired = deterministicQualifyFallback({
      qualification,
      lastInboundText: lastInbound,
      transcript,
      objective: gen.objective,
      salesMove: classified.salesMove,
      salesStrategy: classified.salesStrategy,
      lang,
    })
    reply = withGreeting(greetingLine, repaired)
    if (!validateAutoResponse(reply, validateOpts).ok) {
      reply = safeFallbackReply('acknowledgement', lang, greetingLine)
    }
  }

  return {
    ok: true,
    reply,
    usedDraft,
    profileDerived: Boolean(identity.profile) || derivedNow,
    trace: {
      greeted: Boolean(greetingLine),
      language: lang,
      salesMove: classified.salesMove,
      control: control.action,
      validator,
      simulated: null,
    },
  }
}
