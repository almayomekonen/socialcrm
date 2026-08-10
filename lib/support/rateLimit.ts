/**
 * Basic abuse protection for an authenticated endpoint. Nothing more.
 *
 * PER USER, not per agency, and deliberately: one rep looping the form must
 * never lock their four colleagues out of reaching us. The whole purpose of this
 * surface is being reachable — a rate limiter that can silence an entire
 * workspace defeats the feature it is protecting.
 *
 * Replies are NOT capped. A conversation is not abuse, and a customer who has
 * already been answered is mid-dialogue, not attacking anything.
 */

export const SUPPORT_REQUESTS_PER_HOUR = 10

const HOUR_MS = 60 * 60 * 1000

export function rateLimitWindowStart(now: Date): Date {
  return new Date(now.getTime() - HOUR_MS)
}

export function isOverRequestLimit(countInWindow: number): boolean {
  return countInWindow >= SUPPORT_REQUESTS_PER_HOUR
}
