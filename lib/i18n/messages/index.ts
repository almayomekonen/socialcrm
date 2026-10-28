import type { UiLocale } from '../config'
import type { Messages } from '../translate'
import { he } from './he'
import { en } from './en'
import { ar } from './ar'

export const CATALOGS: Record<UiLocale, Messages> = { he, en, ar }
