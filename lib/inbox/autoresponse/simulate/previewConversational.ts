import 'server-only'
import { getChannelSettings } from '@/db/autoResponseSettings'
import { loadBusinessIdentity, type BusinessIdentity } from '../businessIdentity'
import { isQualifierEnabled } from '../killSwitch'
import { sanitiseSimState, simulateConversationalTurn, type SimResult, type SimState, type SimTurn } from './simulateTurn'
import { withDraftAgentProfile, type DraftAgentProfileFields } from './draftAgentProfile'

/**
 * "בדקו את הסוכן שלכם" for an agency on the conversational agent
 * (IRE_CONVERSATIONAL_AGENCY_IDS). The owner's chat runs through the real
 * agent (simulateTurn.ts); this file only checks that the real agent is what
 * this agency runs, and words the outcome for the chat.
 *
 * It never falls back to the legacy preview: when the agency's WhatsApp would
 * not run the conversational agent, the owner gets a clear reason instead.
 */

export type ConversationalPreview =
  | {
      ok: true
      reply: string
      usedDraft: boolean
      profileDerived: boolean
      state: SimState
      trace: {
        greeted: boolean
        language: 'he' | 'en'
        salesMove: string | null
        control: string
        validator: string
        simulated: string | null
        mode: string | null
      }
    }
  | { ok: false; reason: string }

/** What the real agent would have done, said plainly. Null when the reply speaks for itself. */
export function simulatedNote(r: Pick<SimResult, 'outcome' | 'reply'>): string | null {
  if (r.outcome === 'handoff') return 'בשיחה אמיתית השיחה הייתה מועברת לצוות עם סיכום. כאן לא נשלחה התראה לאף אחד.'
  if (r.outcome === 'closed') return r.reply ? 'בשיחה אמיתית השיחה הייתה נסגרת אחרי ההודעה הזו.' : 'בשיחה אמיתית הסוכן היה שותק כאן ומסמן את השיחה כסגורה.'
  if (r.outcome === 'silent') return 'בשיחה אמיתית הסוכן לא היה שולח הודעה בתור הזה.'
  return null
}

export async function previewConversationalTurn(input: {
  agencyId: number
  /** The preview's identity: saved settings, or the owner's unsaved description. */
  draftIdentity: Pick<BusinessIdentity, 'guidance' | 'agentInstructions' | 'profile'>
  usedDraft: boolean
  profileDerived: boolean
  transcript: SimTurn[]
  state: unknown
  /** The owner's unsaved greeting / tone / FAQ. Absent fields keep the saved profile. */
  draftProfile?: DraftAgentProfileFields
  nowMs?: number
}): Promise<ConversationalPreview> {
  const settings = await getChannelSettings(input.agencyId, 'whatsapp')
  // The conversational agent runs only for the AI agent responder in qualify mode.
  if (!settings || settings.responder === 'questionnaire' || settings.mode !== 'qualify') {
    return { ok: false, reason: 'conversational_unavailable' }
  }
  if (isQualifierEnabled() === false) return { ok: false, reason: 'agent_paused' }

  // The live identity (agent profile included), with the description under test.
  const saved = await loadBusinessIdentity(input.agencyId, 'whatsapp')
  const draftProfile = withDraftAgentProfile(saved.agentProfile, input.draftProfile)
  const identity: BusinessIdentity = { ...saved, ...input.draftIdentity, agentProfile: draftProfile.profile }
  const usedDraft = input.usedDraft || draftProfile.changed

  const sim = await simulateConversationalTurn({
    agencyId: input.agencyId,
    settings,
    identity,
    transcript: input.transcript,
    state: sanitiseSimState(input.state),
    nowMs: input.nowMs ?? Date.now(),
  })
  if ('unavailable' in sim) return { ok: false, reason: 'conversational_unavailable' }
  // The same reasons the legacy preview returned for a failed model call (ai_unavailable, budget_exhausted…).
  if ('generationFailed' in sim) return { ok: false, reason: sim.generationFailed }

  return {
    ok: true,
    reply: sim.reply,
    usedDraft,
    profileDerived: input.profileDerived,
    state: sim.state,
    trace: {
      greeted: sim.greeted,
      language: sim.language,
      salesMove: sim.salesMove,
      control: sim.reason ? `${sim.outcome}:${sim.reason}` : sim.outcome,
      validator: sim.validator,
      simulated: simulatedNote(sim),
      mode: sim.mode,
    },
  }
}
