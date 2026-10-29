'use client'

import { useCallback, useRef, useState } from 'react'
import { attachmentRejectionCopy, checkMessengerAttachment } from '@/lib/facebook/messenger/attachmentRules'
import type { MessengerSendFailure } from '@/lib/facebook/messenger/rules'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

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

/** The send failures the upload route can answer with, as composer copy keys. */
const FAILURE_KEYS: Record<MessengerSendFailure, MessageKey> = {
  not_enabled: 'inbox.messenger.failure.not_enabled',
  not_found: 'inbox.messenger.failure.not_found',
  empty: 'inbox.messenger.failure.empty',
  too_long: 'inbox.messenger.failure.too_long',
  invalid_file: 'inbox.messenger.failure.invalid_file',
  window_closed: 'inbox.messenger.failure.window_closed',
  permission_missing: 'inbox.messenger.failure.permission_missing',
  reconnect_required: 'inbox.messenger.failure.reconnect_required',
  recipient_unavailable: 'inbox.messenger.failure.recipient_unavailable',
  rate_limited: 'inbox.messenger.failure.rate_limited',
  meta_error: 'inbox.messenger.failure.meta_error',
}

/**
 * What a refused upload says. Hebrew is unchanged: the route's own `detail`
 * (its Hebrew attachment-rule text) or the generic line. Another language
 * cannot show that Hebrew `detail`, so it says the same thing by the route's
 * `reason` CODE when there is a detail to replace, and the generic line otherwise.
 */
function refusedCopy(body: { reason?: string; detail?: string } | null, locale: UiLocale): string {
  const t = translatorFor(locale)
  if (locale === 'he') return body?.detail || t('inbox.messenger.attachment.serverRefused')
  const key = body?.detail && body.reason ? FAILURE_KEYS[body.reason as MessengerSendFailure] : undefined
  return t(key ?? 'inbox.messenger.attachment.serverRefused')
}

export function useAttachmentUpload(conversationId: number, locale: UiLocale = 'he') {
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
          setState({ phase: 'error', message: attachmentRejectionCopy(check.reason, locale) })
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
          setState({ phase: 'error', message: translatorFor(locale)('inbox.messenger.attachment.networkFailed') })
          resolve(false)
        }
        req.onabort = () => {
          xhr.current = null
          resolve(false)
        }
        req.onload = () => {
          xhr.current = null
          const body = req.response as { ok?: boolean; reason?: string; detail?: string; captionFailed?: boolean } | null
          if (req.status >= 200 && req.status < 300 && body?.ok) {
            setState({ phase: 'idle' })
            resolve(true)
            return
          }
          setState({ phase: 'error', message: refusedCopy(body, locale) })
          resolve(false)
        }
        req.send(form)
      }),
    [conversationId, locale],
  )

  return { state, upload, cancel, reset }
}
