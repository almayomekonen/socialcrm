import { NextResponse } from 'next/server'
import { sendMessengerAttachment } from '@/lib/facebook/messenger/sendAttachment'
import { sendMessengerText } from '@/lib/facebook/messenger/send'
import {
  ATTACHMENT_REJECTION_COPY,
  checkMessengerAttachment,
  MESSENGER_ATTACHMENT_MAX_BYTES,
} from '@/lib/facebook/messenger/attachmentRules'
import { MESSENGER_TEXT_MAX } from '@/lib/facebook/messenger/rules'
import { authorizeMessengerSend, failFromGraph, recordOutbound } from '@/modules/messenger/sendGuards'

/**
 * Send a Messenger attachment.
 *
 * WHY A ROUTE HANDLER AND NOT A SERVER ACTION. Everything else in this feature
 * is a Server Action, and should stay that way. Upload PROGRESS is the one thing
 * a Server Action cannot give: the browser hands the request to the framework
 * and gets no `upload.onprogress`. The alternatives were an indeterminate
 * spinner for a 25 MB file on a phone, or a fake animated bar — and a fake
 * progress bar is a lie about work (frontend guidelines §13, §21). So the bytes
 * go through XHR to this route, which reports real progress.
 *
 * It is NOT a parallel data layer: it reuses `authorizeMessengerSend` — the same
 * entitlement, rollout, tenancy, window, grant and token chain as every other
 * send — and the same `recordOutbound`. The only thing this file adds is the
 * HTTP envelope.
 *
 * The file is never written to disk and never given a public URL; it is streamed
 * to Meta (see lib/facebook/messenger/sendAttachment.ts).
 */
// Media, not JSON: a large upload on a slow connection needs more than the default.
//
// No `export const runtime`: this project builds with `cacheComponents`, which
// rejects that route-segment config outright (and the Node runtime, which this
// needs for the multipart stream to Meta, is the default anyway).
export const maxDuration = 60

export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_file' }, { status: 400 })
  }

  const file = form.get('file')
  const conversationId = Number(form.get('conversationId'))
  const caption = typeof form.get('caption') === 'string' ? (form.get('caption') as string).trim() : ''

  if (!(file instanceof File)) return NextResponse.json({ ok: false, reason: 'empty' }, { status: 400 })
  if (caption.length > MESSENGER_TEXT_MAX) return NextResponse.json({ ok: false, reason: 'too_long' }, { status: 400 })

  // AUTHORIZE BEFORE INSPECTING THE CONTENT. The body has to be parsed first to
  // learn which conversation this is, but nothing about the file is judged until
  // the caller has been shown to be entitled to send to it — otherwise an
  // unauthenticated or expired caller learns "your file is too large" from an
  // endpoint they may not use at all, and an expired subscriber is told about
  // their file instead of their subscription.
  //
  // Throws for an expired subscription (requireProductAccess), which Next turns
  // into an error response — the same entitlement behaviour as the text action.
  const guard = await authorizeMessengerSend(conversationId)
  if ('reason' in guard) {
    const status = guard.reason === 'not_found' ? 404 : guard.reason === 'window_closed' ? 409 : 403
    return NextResponse.json({ ok: false, reason: guard.reason }, { status })
  }
  const { ctx } = guard

  // Re-validated server-side with the same pure rule the composer used. The
  // composer's check is a courtesy to the rep; this one is the control.
  const check = checkMessengerAttachment({ size: file.size, type: file.type, name: file.name })
  if ('reason' in check) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_file', detail: ATTACHMENT_REJECTION_COPY[check.reason] },
      { status: 413 },
    )
  }
  // Belt and braces: `File.size` is what the runtime parsed, not a client claim,
  // but the limit is restated here so this route is safe read on its own.
  if (file.size > MESSENGER_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_file', detail: ATTACHMENT_REJECTION_COPY.too_large },
      { status: 413 },
    )
  }

  const sent = await sendMessengerAttachment({
    pageId: ctx.pageId,
    pageAccessToken: ctx.pageAccessToken,
    psid: ctx.psid,
    type: check.type,
    file,
    filename: file.name,
  })
  if ('error' in sent) {
    const failure = await failFromGraph(sent.error, ctx)
    return NextResponse.json(failure, { status: 502 })
  }

  // Recorded WITHOUT a url: Meta returns no CDN link on send, and the echo
  // webhook fills one in. A fabricated url would render as a broken image in
  // the rep's own thread.
  await recordOutbound(ctx, { mid: sent.mid, text: '', attachments: [{ type: check.type, url: null }] })

  // A caption is a separate message — a Messenger attachment carries no text.
  // Its failure is reported separately: the file DID send, and saying otherwise
  // would make the rep send it again.
  let captionFailed = false
  if (caption) {
    const withText = await sendMessengerText({
      pageId: ctx.pageId,
      pageAccessToken: ctx.pageAccessToken,
      psid: ctx.psid,
      text: caption,
    })
    if ('error' in withText) captionFailed = true
    else await recordOutbound(ctx, { mid: withText.mid, text: caption, attachments: [] })
  }

  return NextResponse.json({ ok: true, captionFailed })
}
