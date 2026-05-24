'use client'

import { useCallback, useState, type ChangeEvent } from 'react'
import { extractFile } from '@/lib/copilot/clientExtract'
import { COPILOT_MAX_ATTACHMENTS, COPILOT_MAX_FILE_BYTES } from '@/lib/copilot/attachments'
import { extractionStatus, type AttachmentItem } from './constants'

// File picker state + handlers extracted from CopilotComposer. Owns:
//   attachedFiles    — list of File items + their extraction status
//   fileError        — user-facing error message (null when clean)
//   preparingFiles   — true while submit() is in the middle of uploading
//
// Submit-side concerns (uploading, marking 'uploading' / 'error') stay in
// the composer, but it calls `markAllUploading()` and `markAllError()` here
// to keep state mutation in one place.
export function useComposerFiles() {
  const [attachedFiles, setAttachedFiles] = useState<AttachmentItem[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [preparingFiles, setPreparingFiles] = useState(false)

  const onFilesPicked = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(e.target.files ?? [])
      if (picked.length === 0) return
      setFileError(null)

      setAttachedFiles((prevAttached) => {
        const remainingSlots = Math.max(0, COPILOT_MAX_ATTACHMENTS - prevAttached.length)
        const accepted = picked.filter((f) => f.size <= COPILOT_MAX_FILE_BYTES).slice(0, remainingSlots)
        if (picked.some((f) => f.size > COPILOT_MAX_FILE_BYTES)) setFileError('קובץ אחד גדול מדי לצירוף.')
        if (picked.filter((f) => f.size <= COPILOT_MAX_FILE_BYTES).length > accepted.length) {
          setFileError(`אפשר לצרף עד ${COPILOT_MAX_ATTACHMENTS} קבצים.`)
        }
        if (accepted.length === 0) return prevAttached

        const items: AttachmentItem[] = accepted.map((file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          file,
          status: 'reading' as const,
        }))

        for (const item of items) {
          void extractFile(item.file).then((extracted) => {
            setAttachedFiles((prev) =>
              prev.map((current) =>
                current.id === item.id ? { ...current, extracted, status: extractionStatus(extracted) } : current,
              ),
            )
          })
        }

        return [...prevAttached, ...items]
      })

      e.target.value = ''
    },
    [],
  )

  const removeAttachedFile = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const markAllUploading = useCallback(() => {
    setAttachedFiles((prev) => prev.map((item) => ({ ...item, status: item.extracted ? 'uploading' : item.status })))
  }, [])

  const markAllError = useCallback(() => {
    setAttachedFiles((prev) => prev.map((item) => ({ ...item, status: 'error' })))
  }, [])

  const clearFiles = useCallback(() => {
    setAttachedFiles([])
  }, [])

  return {
    attachedFiles,
    fileError,
    setFileError,
    preparingFiles,
    setPreparingFiles,
    onFilesPicked,
    removeAttachedFile,
    markAllUploading,
    markAllError,
    clearFiles,
  }
}
