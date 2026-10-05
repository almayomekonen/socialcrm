'use client'

import { useImageFailed } from '@/lib/useImageFailed'

/** A small ad-creative thumbnail; renders nothing once Meta's expiring URL stops loading. */
export default function AdThumb({ url }: { url: string }) {
  const image = useImageFailed()
  if (image.failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- expiring Meta CDN URL, not a static asset
    <img
      src={url}
      alt=''
      aria-hidden
      loading='lazy'
      decoding='async'
      referrerPolicy='no-referrer'
      ref={image.ref}
      onError={image.onError}
      className='size-10 shrink-0 rounded object-cover'
    />
  )
}
