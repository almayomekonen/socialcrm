import { readSnapshots, writeSnapshot } from '@/db/adsSnapshots'
import { adsFail, isAdObjectId } from '@/lib/facebook/ads/insights'
import { CREATIVE_TTL_MS, STALE_MAX_MS } from '@/lib/facebook/ads/cached'
import { readObjects } from '@/lib/facebook/ads/perObject'

/**
 * What an ad looks like, so the report can show it instead of an id.
 *
 * Two documented `ads_read` reads per ad (Ad Creative reference, checked
 * 2026-10-06), one object per request (perObject.ts — `GET /?ids=` is removed
 * from Graph API on 2026-10-27):
 *   1. GET /{ad id}?fields=creative{id}                — the ad's creative
 *   2. GET /{creative id}?fields=image_url,thumbnail_url,object_type,video_id
 *        &thumbnail_width=600&thumbnail_height=600     — "URL for a thumbnail image
 *        for this ad creative", sized by the documented thumbnail_* parameters.
 *
 * Ad ids only ever come from insights rows Meta returned for the VERIFIED
 * account — never from the URL. Only https URLs Meta returned are kept; nothing
 * is constructed. CDN URLs expire, so each ad's creative is cached (kind
 * 'creative') and refreshed after CREATIVE_TTL_MS; a failed refresh keeps the
 * older one up to STALE_MAX_MS, and the browser falls back if it no longer loads.
 */

export type AdCreative = {
  /** The best image to show: the creative's image, else Meta's thumbnail. */
  imageUrl: string | null
  isVideo: boolean
}

export const MAX_CREATIVE_ADS = 60
const THUMB_PX = 600

const https = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null
  try {
    return new URL(v).protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

/** One creative node → what the card shows. Pure. */
export function creativeOf(node: Record<string, unknown> | undefined): AdCreative {
  const isVideo = node?.object_type === 'VIDEO' || typeof node?.video_id === 'string'
  // A video's image_url is not a frame of the video; its thumbnail is.
  const imageUrl = isVideo ? https(node?.thumbnail_url) : (https(node?.image_url) ?? https(node?.thumbnail_url))
  return { imageUrl, isVideo }
}

async function fetchCreatives(token: string, adIds: string[]): Promise<Map<string, AdCreative> | null> {
  const ads = await readObjects<{ creative?: { id?: unknown } }>(
    token,
    adIds,
    { fields: 'creative{id}' },
    { max: MAX_CREATIVE_ADS },
  )
  if (ads.error) {
    adsFail(ads.error, 'ad creatives')
    return null
  }
  const creativeOfAd = new Map<string, string>()
  for (const [adId, ad] of ads.values) {
    const cid = ad.creative?.id
    if (typeof cid === 'string' && isAdObjectId(cid)) creativeOfAd.set(adId, cid)
  }

  const creatives = await readObjects<Record<string, unknown>>(
    token,
    [...new Set(creativeOfAd.values())],
    { fields: 'image_url,thumbnail_url,object_type,video_id', thumbnail_width: THUMB_PX, thumbnail_height: THUMB_PX },
    { max: MAX_CREATIVE_ADS },
  )
  if (creatives.error) {
    adsFail(creatives.error, 'creative images')
    return null
  }
  const nodes = creatives.values

  const out = new Map<string, AdCreative>()
  for (const adId of adIds) {
    const cid = creativeOfAd.get(adId)
    out.set(adId, creativeOf(cid ? nodes.get(cid) : undefined))
  }
  return out
}

/**
 * Creatives for the given ads, cached per ad. Never throws; an ad whose creative
 * could not be read is simply absent (the card shows its fallback).
 */
export async function getAdCreatives(
  scope: { agencyId: number; accountId: string },
  token: string,
  adIds: string[],
  now: Date = new Date(),
): Promise<Map<string, AdCreative>> {
  const ids = [...new Set(adIds.filter(isAdObjectId))].slice(0, MAX_CREATIVE_ADS)
  const out = new Map<string, AdCreative>()
  if (ids.length === 0) return out
  try {
    const cached = await readSnapshots<AdCreative>({ ...scope, kind: 'creative' }, ids)
    const due: string[] = []
    for (const id of ids) {
      const snap = cached.get(id)
      const age = snap ? now.getTime() - snap.fetchedAt.getTime() : Infinity
      if (snap && age < STALE_MAX_MS) out.set(id, snap.payload)
      if (!snap || age >= CREATIVE_TTL_MS) due.push(id)
    }
    if (due.length === 0) return out
    const fresh = await fetchCreatives(token, due)
    if (!fresh) return out
    for (const [adId, creative] of fresh) {
      out.set(adId, creative)
      await writeSnapshot({ ...scope, kind: 'creative' }, adId, creative, now).catch(() => {})
    }
  } catch (err) {
    console.warn('[AdsReporting] creatives unavailable:', err instanceof Error ? err.message : 'unknown')
  }
  return out
}
