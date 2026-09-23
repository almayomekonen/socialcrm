'use client'

import { useCallback, useRef, useState } from 'react'
import { ATTACHMENT_REJECTION_COPY, checkMessengerAttachment } from '@/lib/facebook/messenger/attachmentRules'

/**
 * Upload one attachment to `/api/messenger/attachment`, with REAL progress.
 *
 * XHR, not fetch: `XMLHttpRequest.upload.onprogress` is still the only way in a
 * browser to observe how many bytes have actually left. `fetch` would force a
 * choice between an indeterminate spinner and an animated bar that invents its
 * own numbers — and inventing progress is lying about work.
 *
 * `progress` is null until the first real `loaded` event, so the UI shows
 * "מעלה…" rather than a confident 0%. Once the bytes are gone but the server is
 * still talking to Meta, it sits at 100 and the label changes to "שולח…" —
 * which is what is genuinely happening.
 */

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; progress: number | null }
  | { phase: 'sending' }
  | { phase: 'error'; message: string }

const NETWORK_FAILED = 'העלאת הקובץ נכשלה. בדוק את החיבור ונסה שוב.'
const SERVER_REFUSED = 'הקובץ לא נשלח. נסה שוב.'

export function useAttachmentUpload(conversationId: number) {
  const [state, setState] = useState<UploadState>({ phase: 'idle' })
  const xhr = useRef<XMLHttpRequest | null>(null)

  const cancel = useCallback(() => {
    xhr.current?.abort()
    xhr.current = null
    setState({ phase: 'idle' })
  }, [])

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  const upload = useCallback(
    (file: File, caption: string) =>
      new Promise<boolean>((resolve) => {
        // The same pure rule the server enforces — run first so an oversized
        // file fails instantly instead of after a 25 MB round trip.
        const check = checkMessengerAttachment({ size: file.size, type: file.type, name: file.name })
        if ('reason' in check) {
          setState({ phase: 'error', message: ATTACHMENT_REJECTION_COPY[check.reason] })
          resolve(false)
          return
        }

        const form = new FormData()
        form.set('conversationId', String(conversationId))
        form.set('file', file)
        if (caption) form.set('caption', caption)

        const req = new XMLHttpRequest()
        xhr.current = req
        req.open('POST', '/api/messenger/attachment')
        req.responseType = 'json'
        setState({ phase: 'uploading', progress: null })

        req.upload.onprogress = (e) => {
          // `lengthComputable` is false for chunked encodings; showing a
          // percentage we cannot compute would be a made-up number.
          const pct = e.lengthComputable && e.total > 0 ? Math.min(100, Math.round((e.loaded / e.total) * 100)) : null
          setState({ phase: 'uploading', progress: pct })
        }
        // Bytes delivered; the server is now talking to Meta on our behalf.
        req.upload.onload = () => setState({ phase: 'sending' })

        req.onerror = () => {
          xhr.current = null
          setState({ phase: 'error', message: NETWORK_FAILED })
          resolve(false)
        }
        req.onabort = () => {
          xhr.current = null
          resolve(false)
        }
        req.onload = () => {
          xhr.current = null
          const body = req.response as { ok?: boolean; detail?: string; captionFailed?: boolean } | null
          if (req.status >= 200 && req.status < 300 && body?.ok) {
            setState({ phase: 'idle' })
            resolve(true)
            return
          }
          setState({ phase: 'error', message: body?.detail || SERVER_REFUSED })
          resolve(false)
        }
        req.send(form)
      }),
    [conversationId],
  )

  return { state, upload, cancel, reset }
}
