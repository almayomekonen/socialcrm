import type { IconNames } from '@/lib/Icon'

/**
 * The product's lead-source vocabulary — the channels a lead can arrive from.
 *
 * WHY IT LIVES HERE AND NOT BESIDE THE DASHBOARD: `builderBoundary.test.ts`
 * Law 1 forbids an integration name appearing as a string literal anywhere
 * under `components/settings/automations` or `lib/automations/catalog`, because
 * the Builder must never become integration-aware. Displaying lead sources is
 * a product concern rather than a Builder one, so the vocabulary belongs
 * outside those directories — and being shared is the point: any surface that
 * shows where a lead came from should read from this one registry.
 *
 * Marks are MONOCHROME by default. The silhouettes are recognisable on their
 * own, and four brand hues in a row is the logo salad every other CRM ships.
 * `hoverClass` reveals the true brand colour on hover, one source at a time.
 */

export type SourceKey = 'whatsapp' | 'facebook' | 'instagram' | 'website'

export type SourceMeta = {
  key: SourceKey
  label: string
  icon: IconNames
  /** Brand colour, applied on hover only. Never at rest. */
  hoverClass: string
}

export const LEAD_SOURCES: Record<SourceKey, SourceMeta> = {
  whatsapp: { key: 'whatsapp', label: 'וואטסאפ', icon: 'whatsapp', hoverClass: 'group-hover/src:bg-[#25D366]' },
  facebook: { key: 'facebook', label: 'פייסבוק', icon: 'facebook', hoverClass: 'group-hover/src:bg-[#1877F2]' },
  instagram: { key: 'instagram', label: 'אינסטגרם', icon: 'instagram', hoverClass: 'group-hover/src:bg-[#E4405F]' },
  website: { key: 'website', label: 'אתר', icon: 'globe', hoverClass: 'group-hover/src:bg-[#2563EB]' },
}

export const SOURCE_ORDER: readonly SourceKey[] = ['whatsapp', 'facebook', 'instagram', 'website']
