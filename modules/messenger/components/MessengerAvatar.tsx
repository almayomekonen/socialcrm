'use client'

import LeadAvatar from '@/components/ui/lead-avatar'
import { useImageFailed } from '@/lib/useImageFailed'

/**
 * The customer's real Facebook picture, with initials as the fallback.
 *
 * WHY THIS IS A CLIENT COMPONENT. `profilePicUrl` is a SIGNED Meta CDN URL that
 * expires. A server render cannot know whether it still resolves, and a stale
 * one renders as a broken-image glyph — the one outcome worse than initials.
 * The only place that can detect it is the browser, via `onError`, so the
 * fallback lives here and swaps in the instant the image fails. The refresh that
 * fixes it for good happens server-side on the next sweep (profile.ts).
 *
 * NEVER INVENTS. `src` is only ever the URL Meta returned for THIS PSID. There
 * is no placeholder photo and no generated face: when there is no picture, or it
 * will not load, the rep sees initials — which are derived from a name Meta
 * gave us, or the neutral fallback when it gave us none.
 *
 * Reuses `LeadAvatar` for the fallback so a Messenger contact looks exactly like
 * every other contact in the CRM (shared-component registry, architecture §10).
 */
export default function MessengerAvatar({
  name,
  picUrl,
  size = 'sm',
}: {
  name: string | null
  picUrl: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  // Also catches a URL that already failed before hydration (see useImageFailed).
  const { failed: broken, ref, onError } = useImageFailed()

  if (!picUrl || broken) return <LeadAvatar name={name} size={size} />

  const px = size === 'lg' ? 'size-12' : size === 'md' ? 'size-10' : 'size-8'
  return (
    // eslint-disable-next-line @next/next/no-img-element -- expiring Meta CDN URL, not a static asset
    <img
      src={picUrl}
      alt=''
      aria-hidden
      loading='lazy'
      decoding='async'
      // Meta's CDN does not want our origin, and we do not want to leak the
      // conversation URL to it.
      referrerPolicy='no-referrer'
      ref={ref}
      onError={onError}
      className={`${px} shrink-0 rounded-full bg-primary-tint object-cover`}
    />
  )
}
