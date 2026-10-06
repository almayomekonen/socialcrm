'use client'

import { useCallback, useState } from 'react'

/**
 * "Did this <img> fail to load?" — for expiring remote images (Meta CDN URLs).
 *
 * `onError` alone is not enough for server-rendered HTML: the browser can start,
 * and FAIL, the request before React hydrates and attaches the handler, and
 * that error event is never replayed. The ref closes the gap: when the element
 * mounts, an image the browser already finished with no pixels (`complete` and
 * `naturalWidth === 0`) is reported as failed too.
 */
export function useImageFailed() {
  const [failed, setFailed] = useState(false)
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0 && img.getAttribute('src')) setFailed(true)
  }, [])
  const onError = useCallback(() => setFailed(true), [])
  return { failed, ref, onError }
}
