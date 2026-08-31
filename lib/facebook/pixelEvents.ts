import { isMetaTrackingEnabled } from './pixelEnv'

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
  }
}

type MetaStandardEvent = 'PageView' | 'CompleteRegistration' | 'StartTrial' | 'Subscribe'

/**
 * Generic utility for tracking Meta Pixel standard events.
 * Safe to call anywhere — no-ops on the server or if the pixel hasn't loaded.
 */
export function trackPixelEvent(event: MetaStandardEvent, params?: Record<string, unknown>) {
  // Defence in depth. MetaPixel already refuses to boot outside production, so
  // `window.fbq` is normally absent there — but a stray fbq (a browser
  // extension, a stale tab, a future caller that bootstraps its own stub) must
  // not become a write path into the production dataset.
  if (!isMetaTrackingEnabled()) return
  if (typeof window === 'undefined' || !window.fbq) return
  window.fbq('track', event, params)
}

// Pre-built helpers — defined but not triggered anywhere yet.
export const trackCompleteRegistration = (params?: Record<string, unknown>) =>
  trackPixelEvent('CompleteRegistration', params)

export const trackStartTrial = (params?: Record<string, unknown>) => trackPixelEvent('StartTrial', params)

export const trackSubscribe = (params?: Record<string, unknown>) => trackPixelEvent('Subscribe', params)
