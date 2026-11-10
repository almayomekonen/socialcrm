/**
 * Shared types of the qualify turn.
 *
 * Part of the qualify turn (../qualifyWorker.ts), moved out unchanged so the
 * orchestrator stays reviewable (architecture-rules §1, §5). Behaviour-preserving:
 * the statements are the original ones, in the original order.
 */
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { type AutoResponseJob } from '@/db/autoResponseJobs'
import type { AutoResponseSettings } from '@/db/autoResponseSettings'
import { generateQualifyTurn } from '../qualify'

export type Outcome = 'sent' | 'skipped' | 'failed'

export interface QualifyCtx {
  master: boolean
  settings: AutoResponseSettings
  conv: { id: number; businessPhoneNumberId: string; customerWaId: string | null; customerName: string | null }
  lead: { id: number | null; userId: number | null; handlerId: number | null; status: string | null }
}
export interface QualifyDeps {
  send: typeof sendWhatsappText
  generateQualify: typeof generateQualifyTurn
}

const WINDOW_MS = 24 * 60 * 60 * 1000
/** What every moved piece receives from the orchestrator. */
export type TurnBase = {
  job: AutoResponseJob
  ctx: QualifyCtx
  deps: QualifyDeps
  doSkip: (reason: string) => Promise<Outcome>
  reliability: boolean
}
export type TurnFacts = Awaited<ReturnType<typeof import('./turnFacts').readTurnFacts>>
export type TurnResponders = ReturnType<typeof import('./responders').turnResponders>
export type GenerationInput = Awaited<ReturnType<typeof import('./generateTurn').prepareGeneration>>
export type GeneratedTurn = Extract<Awaited<ReturnType<typeof import('./generateTurn').generateValidatedTurn>>, { gen: unknown }>

