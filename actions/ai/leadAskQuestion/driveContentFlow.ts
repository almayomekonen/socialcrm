import { COPILOT_ATTACHMENT_TOTAL_CHAR_CAP } from '@/lib/copilot/attachments'
import type { LeadQuestionAttachmentContext } from '@/lib/ai/prompts/leadAskQuestion'
import {
  readDriveFileContent,
  type DriveFileContent,
  type DriveReadFailureReason,
  type DriveReadResult,
} from '@/lib/integrations/google/driveFileReader'
import { listDriveFilesForLead } from '@/db/leadDriveFiles'

const MAX_AUTO_INJECT_ATTACHED = 3

export function isReadFailure(r: DriveReadResult): r is { ok: false; reason: DriveReadFailureReason } {
  return r.ok === false
}

export function isReadSuccess(r: DriveReadResult): r is { ok: true; content: DriveFileContent } {
  return r.ok === true
}

function mapFailureReason(r: DriveReadFailureReason): 'unsupported-type' | 'extraction-failed' | 'empty-text' {
  return r === 'unsupported-type' || r === 'empty-text' ? r : 'extraction-failed'
}

function usedChars(attachments: LeadQuestionAttachmentContext[]): number {
  return attachments.reduce((s, a) => (a.kind === 'text' ? s + a.content.length : s), 0)
}

export async function injectAttachedDriveFiles({
  promptAttachments,
  leadId,
  agencyId,
  userId,
}: {
  promptAttachments: LeadQuestionAttachmentContext[]
  leadId: number
  agencyId: number
  userId: number
}): Promise<void> {
  let attachedDriveRows: Awaited<ReturnType<typeof listDriveFilesForLead>> = []
  try {
    attachedDriveRows = await listDriveFilesForLead({ leadId, agencyId })
  } catch (err) {
    console.warn('[leadAskQuestion] listDriveFilesForLead failed', (err as Error)?.message)
  }
  if (attachedDriveRows.length === 0) return

  const slice = attachedDriveRows.slice(0, MAX_AUTO_INJECT_ATTACHED)
  const reads = await Promise.all(
    slice.map((row) =>
      readDriveFileContent({
        userId,
        fileId: row.drive_file_id,
        name: row.name,
        mimeType: row.mime_type,
      }).catch(() => null),
    ),
  )

  let injected = 0
  for (let i = 0; i < slice.length; i++) {
    const row = slice[i]
    const result = reads[i]
    const remaining = COPILOT_ATTACHMENT_TOTAL_CHAR_CAP - usedChars(promptAttachments)

    if (remaining <= 0) {
      promptAttachments.push({
        kind: 'unreadable',
        name: row.name,
        mediaType: row.mime_type,
        size: 0,
        reason: 'total-limit',
      })
      continue
    }

    if (!result || isReadFailure(result)) {
      promptAttachments.push({
        kind: 'unreadable',
        name: row.name,
        mediaType: row.mime_type,
        size: 0,
        reason: result && isReadFailure(result) ? mapFailureReason(result.reason) : 'extraction-failed',
      })
      continue
    }

    if (isReadSuccess(result)) {
      const capped = result.content.extractedText.slice(0, remaining)
      const partial = result.content.truncated || capped.length < result.content.extractedText.length
      promptAttachments.push({
        kind: 'text',
        name: result.content.name,
        mediaType: result.content.mimeType,
        size: capped.length,
        content: capped,
        partial,
        originalChars: result.content.originalChars,
      })
      injected++
    }
  }

  if (process.env.COPILOT_TRACE === '1') {
    console.info('[copilot.trace] askLeadQuestion.attachedDriveInjected', {
      considered: slice.length,
      injected,
      totalAttached: attachedDriveRows.length,
    })
  }
}
