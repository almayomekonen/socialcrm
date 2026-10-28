import type { UiLocale } from './config'
import type { he } from './messages/he'

export type Namespace = keyof typeof he

export type ReviewSignOff = { reviewer: string; date: string }

/**
 * Native-language sign-off per namespace. A locale is "supported" beyond the
 * pilot only when every namespace a user can reach is listed here.
 *
 * Filled in ONLY by the product owner after a human native reviewer has read
 * the exported strings (`pnpm i18n:export`). Hebrew is the source language and
 * is not reviewed here. Nothing is signed off yet.
 */
export const REVIEWED: Record<Exclude<UiLocale, 'he'>, Partial<Record<Namespace, ReviewSignOff>>> = {
  en: {},
  ar: {},
}
