import { uploadCopilotAttachments } from '@/lib/copilot/uploadAttachments'
import type { CopilotAttachmentPayload } from '@/lib/copilot/attachments'
import type { LensId } from '@/lib/ai/prompts/leadAskQuestion'
import type { CopilotModeId } from '@/lib/ai/copilotModes'
import type { AttachmentItem } from './constants'

/**
 * Orchestrates the submit flow: upload any extracted attachments, then hand
 * the resulting payloads off to the parent's onSubmit callback. Extracted
 * from CopilotComposer to keep the component under the file-size ceiling.
 */
export async function runComposerSubmit(args: {
  question: string
  lenses: LensId[]
  modeId: CopilotModeId
  files: AttachmentItem[]
  leadId: number | null
  userId: number | null
  onSubmit: (text: string, lenses: LensId[], attachments: CopilotAttachmentPayload[], mode: CopilotModeId) => void
  // file-state callbacks
  setFileError: (msg: string | null) => void
  setPreparingFiles: (v: boolean) => void
  markAllUploading: () => void
  markAllError: () => void
  clearFiles: () => void
  // composer reset
  clearValue: () => void
  clearLenses: () => void
}): Promise<void> {
  const {
    question,
    lenses,
    modeId,
    files,
    leadId,
    userId,
    onSubmit,
    setFileError,
    setPreparingFiles,
    markAllUploading,
    markAllError,
    clearFiles,
    clearValue,
    clearLenses,
  } = args

  try {
    setFileError(null)
    setPreparingFiles(files.length > 0)

    let attachments: CopilotAttachmentPayload[] = []
    if (files.length > 0) {
      if (!leadId || !userId) {
        setFileError('אי אפשר לצרף קובץ בלי ליד פעיל.')
        return
      }
      const readyFiles = files.filter((item) => item.extracted)
      markAllUploading()
      attachments = await uploadCopilotAttachments({
        items: readyFiles.map((item) => ({ file: item.file, extracted: item.extracted! })),
        leadId,
        userId,
      })
    }

    onSubmit(question, lenses, attachments, modeId)
    clearValue()
    clearLenses()
    clearFiles()
  } catch (err) {
    const e = err as { message?: string; name?: string }
    const msg = typeof e?.message === 'string' ? e.message.slice(0, 200) : String(err)
    console.warn(
      '[upload] copilot.fatal',
      JSON.stringify({ where: 'CopilotComposer.submit', name: e?.name ?? null, message: msg, fileCount: files.length }),
    )
    setFileError('העלאת הקבצים נכשלה. נסה שוב.')
    markAllError()
  } finally {
    setPreparingFiles(false)
  }
}
