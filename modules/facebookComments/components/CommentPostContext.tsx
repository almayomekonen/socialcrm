'use client'

import { useImageFailed } from '@/lib/useImageFailed'
import type { CommentPost } from '../types'

/**
 * Which post the comment was left on — compact, below the comment, never
 * competing with it.
 *
 * Shows only what is actually known: a thumbnail and text once enrichment has
 * read the post, just the link before that (legacy rows, or a pass that has not
 * reached it yet), and a plain "no longer available" when Meta said the post is
 * gone. Nothing is ever shown as loading that is not loading.
 */
export default function CommentPostContext({
  post,
  facebookUrl,
  isReply,
  touch = false,
}: {
  post: CommentPost | undefined
  /** Opens the post at this comment; built from ids, may be null for odd ids. */
  facebookUrl: string | null
  isReply: boolean
  /** Phone: the link is a 44px tap target. */
  touch?: boolean
}) {
  const thumb = useImageFailed()
  const pictureBroken = thumb.failed
  const gone = post?.fetchStatus === 'unavailable'
  const href = gone ? null : (facebookUrl ?? post?.permalinkUrl ?? null)
  const picture = !gone && !pictureBroken ? (post?.pictureUrl ?? null) : null
  const text = gone ? 'הפוסט כבר לא זמין בפייסבוק' : (post?.message ?? null)

  if (!href && !text) return null

  return (
    <div className='mt-3 flex items-start gap-2.5 rounded-md border border-gray-100 bg-gray-50 p-2.5'>
      {picture && (
        // eslint-disable-next-line @next/next/no-img-element -- expiring Meta CDN URL, not a static asset
        <img
          src={picture}
          alt=''
          aria-hidden
          loading='lazy'
          decoding='async'
          referrerPolicy='no-referrer'
          ref={thumb.ref}
          onError={thumb.onError}
          className='size-12 shrink-0 rounded object-cover'
        />
      )}
      <div className='min-w-0 flex-1'>
        <p className='text-[11px] font-medium text-gray-500'>{isReply ? 'תגובה בשרשור על הפוסט' : 'תגובה על הפוסט'}</p>
        {text && <p className={`mt-0.5 line-clamp-2 text-xs leading-snug ${gone ? 'text-gray-400' : 'text-gray-700'}`}>{text}</p>}
        {href && (
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            className={`text-xs text-primary underline underline-offset-2 ${touch ? 'inline-flex min-h-11 items-center' : 'mt-1 inline-block'}`}
          >
            פתח את הפוסט בפייסבוק
          </a>
        )}
      </div>
    </div>
  )
}
