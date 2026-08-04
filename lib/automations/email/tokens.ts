/**
 * Design tokens for customer-automation email (System B — what our customers
 * send to THEIR leads). Platform/lifecycle email is a separate system and does
 * not import this.
 *
 * Why tokens rather than inline values: the pre-Phase-1 renderer carried four
 * unrelated magic numbers (15 / 16 / 24 / 12) and two different line-height
 * conventions, which is how one email ended up with two vertical rhythms. Every
 * spacing and type decision now resolves here, so "premium regardless of what
 * the customer writes" is a property of one file.
 *
 * Constraints these values encode, from the rendering audit:
 *   - Body type is >= 16px. Hebrew below that is uncomfortable on a phone,
 *     which is where leads read.
 *   - Line-height always carries units. Outlook ignores unitless values.
 *   - Spacing is applied in ONE direction only. Adjacent margins collapse in
 *     browsers and do not in Outlook, so both-direction margins give the same
 *     email two rhythms.
 *   - Every colour is declared in a pair with its background, so a dark-mode
 *     client never has to guess a foreground.
 */

/** Hebrew-first stack. Hebrew-capable UI faces first, then the web-safe floor. */
export const FONT_STACK =
  "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, 'Noto Sans Hebrew', sans-serif"

export const TYPE = {
  /** Body copy, and the floor for anything the customer authored. */
  body: { size: '16px', lineHeight: '26px' },
  /** The opening line. Slightly larger so the eye has somewhere to land. */
  greeting: { size: '18px', lineHeight: '28px' },
  /** Sign-off and signature name. */
  signature: { size: '16px', lineHeight: '24px' },
  /** Legal / unsubscribe. Small, but not smaller than 13px in Hebrew. */
  footer: { size: '13px', lineHeight: '20px' },
  /** Button label. */
  action: { size: '16px', lineHeight: '20px' },
} as const

/**
 * A 4px-based scale. Named by role rather than size so a change of rhythm is one
 * edit here instead of a search across components.
 */
export const SPACE = {
  betweenParagraphs: '20px',
  beforeSignature: '28px',
  beforeAction: '28px',
  afterAction: '28px',
  beforeFooter: '32px',
  /** Gutter inside the content cell — on the CELL, never on a table. */
  gutter: '28px',
  gutterMobile: '20px',
  /** Breathing room above the first block and below the last. */
  shellTop: '24px',
  shellBottom: '24px',
} as const

/**
 * Light and dark are declared as explicit pairs. Nothing inherits a colour: an
 * explicit background with an implicit foreground is the most reliable way to
 * produce unreadable text in a dark-mode client.
 */
export const COLOR = {
  light: {
    canvas: '#f4f4f5',
    surface: '#ffffff',
    text: '#18181b',
    textMuted: '#52525b',
    divider: '#e4e4e7',
    /** Default accent. Phase 5 replaces this per-customer, contrast-guarded. */
    accent: '#1d4ed8',
    accentText: '#ffffff',
  },
  dark: {
    canvas: '#18181b',
    surface: '#232327',
    text: '#f4f4f5',
    textMuted: '#a1a1aa',
    divider: '#3f3f46',
    accent: '#5b8def',
    accentText: '#0b0b0d',
  },
} as const

export const LAYOUT = {
  /** Content column. Comfortable measure for Hebrew at 16px. */
  contentWidth: 600,
  radius: '10px',
} as const

/**
 * Direction handling.
 *
 * `dir="auto"` is deliberate rather than lazy: the engine is multi-tenant and
 * nothing constrains authored copy to Hebrew, so the block follows its own first
 * strong character. Alignment is DERIVED from direction and never substituted
 * for it — right-aligning an LTR-based paragraph was the original defect.
 */
export type Direction = 'rtl' | 'ltr' | 'auto'

const RTL_STRONG = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const LTR_STRONG = /[A-Za-zÀ-˿Ͱ-֏]/

/** UBA P2/P3 reduced to what a block needs: first strong character wins. */
export function resolveDirection(text: string): 'rtl' | 'ltr' {
  for (const ch of text) {
    if (RTL_STRONG.test(ch)) return 'rtl'
    if (LTR_STRONG.test(ch)) return 'ltr'
  }
  return 'rtl'
}

/** The one place alignment is allowed to be decided. */
export const alignFor = (dir: 'rtl' | 'ltr'): 'right' | 'left' => (dir === 'rtl' ? 'right' : 'left')
