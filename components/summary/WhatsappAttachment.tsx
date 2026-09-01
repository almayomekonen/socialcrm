'use client'

import { useState } from 'react'
import Icon from '@/lib/Icon'
import type { InboxMessageAttachment } from '@/db/inboxMessages'
import {
  attachmentHref,
  fileKindLabel,
  isAudioAttachment,
  isImageAttachment,
  UNNAMED_ATTACHMENT_LABEL,
  UNNAMED_AUDIO_LABEL,
} from '@/lib/inbox/attachmentDisplay'

/**
 * Inbound WhatsApp media, rendered inside the existing message bubble on both
 * desktop and mobile. One implementation so the two surfaces stay identical.
 *
 * TYPE-AWARE, because a photo is not a download and a voice note is not a file:
 * `image/*` shows the picture, `audio/*` gets a player whose primary action is
 * PLAY, and everything else keeps the file card. The decision is made from
 * the `mimeType` already present in the safe client shape — no media id, no Meta
 * URL, no sha256 is needed to make it, and none is exposed.
 *
 * Both branches point at the SAME authenticated proxy route. The browser sends
 * its own session cookie with the `<img>` request, which is why the picture can
 * load without weakening the route or minting a public URL. `next/image` is
 * deliberately not used: its optimizer fetches server-side without the viewer's
 * cookies and would get a 401.
 */
export default function WhatsappAttachment({
  messageId,
  attachment,
}: {
  messageId: number
  attachment: InboxMessageAttachment
}) {
  /**
   * A picture that cannot load falls back to the file card rather than leaving a
   * broken-image icon — the same honesty rule as the unsupported-type notice.
   */
  const [imageFailed, setImageFailed] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)

  const name = attachment.filename ?? UNNAMED_ATTACHMENT_LABEL
  const kind = fileKindLabel(attachment.mimeType)
  const href = attachmentHref(messageId)

  if (isImageAttachment(attachment.mimeType) && !imageFailed) {
    return (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        aria-label={`פתח את התמונה ${name}`}
        className='block overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; the optimizer cannot send the viewer's cookie */}
        <img
          src={href}
          alt={attachment.filename ?? 'תמונה שהתקבלה בוואטסאפ'}
          loading='lazy'
          decoding='async'
          onError={() => setImageFailed(true)}
          className='block h-auto max-h-[320px] w-auto max-w-full rounded-lg object-contain'
        />
      </a>
    )
  }

  if (isAudioAttachment(attachment.mimeType) && !audioFailed) {
    const audioName = attachment.filename ?? UNNAMED_AUDIO_LABEL
    return (
      <div className='flex min-w-0 flex-col gap-1'>
        {/* A visible name, so the control is not icon-only and a voice note — which
            WhatsApp sends with no filename — still says what it is. */}
        <span className='truncate text-[11px] leading-tight text-gray-500' title={audioName}>
          {audioName}
        </span>
        <audio
          controls
          preload='metadata'
          src={href}
          aria-label={`נגן הקלטה: ${audioName}`}
          onError={() => setAudioFailed(true)}
          className='block h-10 w-[240px] max-w-full rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        />
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5'>
      <Icon name='file' className='size-4 shrink-0 bg-gray-500' />
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm leading-tight text-gray-800' title={name}>
          {name}
        </p>
        {kind && <p className='text-[11px] leading-tight text-gray-500'>{kind}</p>}
      </div>
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        aria-label={`פתח את הקובץ ${name}`}
        className='shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        פתח
      </a>
    </div>
  )
}
