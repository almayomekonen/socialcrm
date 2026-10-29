'use client'

import { useImageFailed } from '@/lib/useImageFailed'
import type { CommentPost } from '../types'
import { customerTextAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Which post the comment was left on, below the comment.
 *
 * With a post picture it is the visual anchor of the card: the image spans the
 * card's width so the rep recognises the post at a glance, then the excerpt and
 * the link. The image keeps its aspect ratio — never stretched — and a tall one
 * is capped and letterboxed (`object-contain`) rather than cropped to a fixed
 * height. Clicking it opens the post; it is a duplicate of the text link below,
 * so it is hidden from assistive tech and the keyboard (one link per target).
 *
 * Without a picture: a compact text block — no empty image frame. Shows only
 * what is actually known: just the link before enrichment has read the post,
 * and a plain "no longer available" when Meta said the post is gone.
 */
export default function CommentPostContext({
  post,
  facebookUrl,
  isReply,
  touch = false,
  locale = 'he',
}: {
  post: CommentPost | undefined
  /** Opens the post at this comment; built from ids, may be null for odd ids. */
  facebookUrl: string | null
  isReply: boolean
  /** Phone: the link is a 44px tap target. */
  touch?: boolean
  /** Our labels only; the post excerpt is the Page's own text. */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const image = useImageFailed()
  const gone = post?.fetchStatus === 'unavailable'
  const href = gone ? null : (facebookUrl ?? post?.permalinkUrl ?? null)
  const picture = !gone && !image.failed ? (post?.pictureUrl ?? null) : null
  const text = gone ? t('inbox.comments.post.gone') : (post?.message ?? null)

  if (!href && !text) return null

  const img = picture ? (
    // eslint-disable-next-line @next/next/no-img-element -- expiring Meta CDN URL, not a static asset
    <img
      src={picture}
      alt=''
      loading='lazy'
      decoding='async'
      referrerPolicy='no-referrer'
      ref={image.ref}
      onError={image.onError}
      className='block h-auto max-h-64 w-full object-contain sm:max-h-[280px]'
    />
  ) : null

  return (
    <div className='mt-3 overflow-hidden rounded-md border border-gray-100 bg-gray-50'>
      {img &&
        (href ? (
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            aria-hidden
            tabIndex={-1}
            data-post-image
            className='block'
          >
            {img}
          </a>
        ) : (
          <div data-post-image>
            {img}
          </div>
        ))}
      <div className='p-2.5'>
        <p className='text-[11px] font-medium text-gray-500'>{isReply ? t('inbox.comments.post.inThread') : t('inbox.comments.post.onPost')}</p>
        {text && (
          <p
            className={`mt-0.5 line-clamp-2 text-xs leading-snug ${gone ? 'text-gray-400' : 'text-gray-700'}`}
            {...(gone ? {} : customerTextAttrs(locale))}
          >
            {text}
          </p>
        )}
        {href && (
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            className={`text-xs text-primary underline underline-offset-2 ${touch ? 'inline-flex min-h-11 items-center' : 'mt-1 inline-block'}`}
          >
            {t('inbox.comments.post.open')}
          </a>
        )}
      </div>
    </div>
  )
}
