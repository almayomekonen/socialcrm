'use client'

import Icon from '@/lib/Icon'
import { useImageFailed } from '@/lib/useImageFailed'

/**
 * The ad's creative as Meta returned it, or a quiet fallback. Meta's CDN URLs
 * are signed and expire; an image that no longer loads (even before hydration —
 * see useImageFailed) swaps to the fallback rather than a broken frame. The
 * image keeps its aspect ratio and is letterboxed, never stretched or cropped.
 */
export default function AdCreativeImage({ url, isVideo, name }: { url: string | null; isVideo: boolean; name: string }) {
  const image = useImageFailed()
  const show = url && !image.failed
  return (
    <div className='relative flex h-44 items-center justify-center overflow-hidden rounded-md bg-gray-50'>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- expiring Meta CDN URL, not a static asset
        <img
          src={url}
          alt={`המודעה ${name}`}
          loading='lazy'
          decoding='async'
          referrerPolicy='no-referrer'
          ref={image.ref}
          onError={image.onError}
          className='block h-full w-full object-contain'
        />
      ) : (
        <div className='grid justify-items-center gap-1 text-gray-400'>
          <Icon name='image' type='lit' className='size-7 bg-gray-300' />
          <span className='text-xs'>אין תמונה זמינה למודעה</span>
        </div>
      )}
      {isVideo && (
        <span className='absolute start-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white'>סרטון</span>
      )}
    </div>
  )
}
