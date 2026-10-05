'use client'

import { useState } from 'react'
import { useImageFailed } from '@/lib/useImageFailed'

/**
 * What the commenter wrote, plus anything they attached.
 *
 * Line breaks are kept (`whitespace-pre-wrap`). A long comment is clamped with
 * an explicit "הצג עוד" — decided from the text itself, so server and client
 * render the same thing. Text Meta never sent reads as "not received", never as
 * an empty comment.
 *
 * An attached photo is Meta's expiring CDN URL: if it no longer loads, the card
 * says so instead of showing a broken image.
 */
const CLAMP_CHARS = 280
const CLAMP_LINES = 4

export default function CommentBody({
  message,
  messageAvailable,
  attachmentType = null,
  attachmentUrl = null,
  touch = false,
}: {
  message: string
  messageAvailable: boolean
  attachmentType?: 'photo' | 'video' | null
  attachmentUrl?: string | null
  /** Phone: toggles and links are 44px tap targets. */
  touch?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const photo = useImageFailed()
  const photoBroken = photo.failed
  const long = message.length > CLAMP_CHARS || message.split('\n').length > CLAMP_LINES

  return (
    <div className='mt-2'>
      {messageAvailable ? (
        <>
          <p
            className={`text-[15px] leading-relaxed break-words whitespace-pre-wrap text-gray-900 ${long && !expanded ? 'line-clamp-4' : ''}`}
          >
            {message}
          </p>
          {long && (
            <button
              type='button'
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={`rounded text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${touch ? 'min-h-11' : 'mt-1'}`}
            >
              {expanded ? 'הצג פחות' : 'הצג עוד'}
            </button>
          )}
        </>
      ) : (
        // Deliberate, not broken: Meta did not send text for this comment (it
        // predates the permission, or the Page has not reconnected since).
        <p className='text-sm text-gray-400 italic'>תוכן התגובה לא התקבל מפייסבוק</p>
      )}

      {attachmentType === 'photo' && attachmentUrl && !photoBroken && (
        <a href={attachmentUrl} target='_blank' rel='noopener noreferrer' className='mt-2 inline-block'>
          {/* eslint-disable-next-line @next/next/no-img-element -- expiring Meta CDN URL, not a static asset */}
          <img
            src={attachmentUrl}
            alt='תמונה שצורפה לתגובה'
            loading='lazy'
            decoding='async'
            referrerPolicy='no-referrer'
            ref={photo.ref}
            onError={photo.onError}
            className='max-h-40 max-w-full rounded-md border border-gray-200 object-cover'
          />
        </a>
      )}
      {attachmentType === 'photo' && attachmentUrl && photoBroken && (
        <p className='mt-1 text-xs text-gray-400'>התמונה שצורפה לתגובה כבר לא זמינה</p>
      )}
      {attachmentType === 'video' && attachmentUrl && (
        <a
          href={attachmentUrl}
          target='_blank'
          rel='noopener noreferrer'
          className={`text-xs text-primary underline underline-offset-2 ${touch ? 'inline-flex min-h-11 items-center' : 'mt-1 inline-block'}`}
        >
          צפה בסרטון שצורף לתגובה
        </a>
      )}
    </div>
  )
}
