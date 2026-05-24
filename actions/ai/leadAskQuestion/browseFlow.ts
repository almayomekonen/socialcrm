import { persistAssistantTurn } from '@/lib/copilot/persistConversation'
import type { AiRunResult, ModelRole } from '@/lib/ai/types'
import type { CopilotModeId } from '@/lib/ai/copilotModes'
import type { CopilotAttachmentPayload } from '@/lib/copilot/attachments'
import type { LensId } from '@/lib/ai/prompts/leadAskQuestion'
import type { DriveResults } from '@/lib/copilot/copilotResponse'
import type { DriveSearchOutcome } from '@/lib/copilot/driveIntent'

/**
 * Pure-browse short-circuit: when the user wants to see files but not
 * synthesize content (no read/summarize/analyze verbs), skip the AI
 * entirely and return a structured drive-results card. Persists the user +
 * assistant turn directly so the timeline reflects the interaction without
 * an AI call.
 */
export async function runBrowseShortCircuit({
  driveOutcome,
  user,
  leadId,
  question,
  lenses,
  rawAttachments,
  roleOverride,
  persistMode,
}: {
  driveOutcome: DriveSearchOutcome
  user: { id: number; agencyId: number }
  leadId: number
  question: string
  lenses: LensId[]
  rawAttachments: CopilotAttachmentPayload[]
  roleOverride: ModelRole
  persistMode: CopilotModeId
}): Promise<AiRunResult<DriveResults>> {
  const browseStartedAt = new Date()

  const browseData: DriveResults = {
    intro: buildBrowseIntro(driveOutcome),
    mode: driveOutcome.mode,
    results: driveOutcome.results.map((r) => ({
      id: r.id,
      name: r.name,
      mimeType: r.mimeType,
      modifiedTime: r.modifiedTime,
      url: r.webViewLink ?? '',
      thumbnailUrl: r.thumbnailLink ?? undefined,
    })),
  }

  const browseResult: AiRunResult<DriveResults> = {
    ok: true,
    data: browseData,
    provider: 'google',
    model: 'drive.search',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: Date.now() - browseStartedAt.getTime(),
  }

  if (process.env.COPILOT_TRACE === '1') {
    console.info('[copilot.trace] driveIntent.browse_short_circuit', {
      count: browseData.results.length,
      mode: browseData.mode,
    })
  }

  await persistAssistantTurn<DriveResults>({
    agencyId: user.agencyId,
    leadId,
    userId: user.id,
    taskKind: 'lead.askQuestion',
    role: roleOverride,
    mode: persistMode,
    actionId: 'drive-results',
    userText: question,
    attachments: rawAttachments,
    lenses,
    structuredPayload: { actionId: 'drive-results', data: browseData },
    assistantSynopsis: browseData.intro,
    result: browseResult,
    startedAt: browseStartedAt,
  })

  return browseResult
}

function buildBrowseIntro(outcome: { mode: 'specific' | 'generic'; results: unknown[] }): string {
  const count = outcome.results.length
  if (count === 0) return 'לא נמצאו קבצים תואמים ב-Google Drive.'
  if (outcome.mode === 'generic') {
    return `הנה ${count} קבצים אחרונים ב-Google Drive שלך:`
  }
  return `נמצאו ${count} קבצים תואמים ב-Google Drive:`
}
