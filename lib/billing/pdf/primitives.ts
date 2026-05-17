/**
 * Shared PDF primitives: page geometry, type scale, color tokens, the
 * DrawCtx type, and the low-level draw helpers used by every renderer.
 *
 * Lives here so renderInvoicePdf.ts and drawReceiptBlock.ts (and future
 * document renderers) can reuse a single visual language without one
 * file growing unbounded.
 */

import { rgb, type PDFFont, type PDFPage } from 'pdf-lib'

// ──────────────────────────────── geometry ──────────────────────────
export const PAGE_WIDTH = 595.28 // A4 in points
export const PAGE_HEIGHT = 841.89
export const MARGIN = 50

// Spacing scale. Same name everywhere in the codebase.
export const SP = { XS: 4, SM: 8, MD: 12, LG: 16, XL: 24, XXL: 32, XXXL: 40 } as const

// Type-size scale. Keep the field names; new sizes get new keys, never renames.
export const TYPE = { FOOTNOTE: 8, LABEL: 9, METADATA: 10, BODY: 11, EMPH: 13, TOTAL: 14, TITLE: 22 } as const

// ──────────────────────────────── colors ────────────────────────────
export const COLOR_TEXT = rgb(0.13, 0.16, 0.2)
export const COLOR_BODY = rgb(0.22, 0.25, 0.3)
export const COLOR_LABEL = rgb(0.45, 0.5, 0.56)
export const COLOR_FAINT = rgb(0.6, 0.64, 0.7)
export const COLOR_RULE_SOFT = rgb(0.91, 0.92, 0.94)
export const COLOR_RULE_FIRM = rgb(0.78, 0.81, 0.85)
export const COLOR_PANEL_FILL = rgb(0.97, 0.972, 0.978)

// Hebrew script detector — used to gate the LTR helpers.
export const HEBREW_RE = /[֐-׿]/

// ──────────────────────────────── types ─────────────────────────────
export type DrawCtx = {
  page: PDFPage
  hebFont: PDFFont
  hebBoldFont: PDFFont
  latinFont: PDFFont
  latinBold: PDFFont
}

export type DrawOptions = {
  x: number
  y: number
  size: number
  bold?: boolean
  color?: ReturnType<typeof rgb>
}

// ──────────────────────────────── draw helpers ──────────────────────

/** Right-anchored Hebrew. `opts.x` is the right edge of the text. */
export function drawRtl(ctx: DrawCtx, text: string, opts: DrawOptions): void {
  const font = opts.bold ? ctx.hebBoldFont : ctx.hebFont
  const reversed = text.split('').reverse().join('')
  const width = font.widthOfTextAtSize(reversed, opts.size)
  ctx.page.drawText(reversed, {
    x: opts.x - width,
    y: opts.y,
    size: opts.size,
    font,
    color: opts.color ?? COLOR_TEXT,
  })
}

/** Left-anchored Latin/numeric. Errors loudly if Hebrew slips in. */
export function drawLtr(ctx: DrawCtx, text: string, opts: DrawOptions): void {
  if (HEBREW_RE.test(text)) {
    throw new Error(`billing.pdf.invalid_routing: Hebrew text passed to drawLtr: "${text.slice(0, 60)}"`)
  }
  const font = opts.bold ? ctx.latinBold : ctx.latinFont
  ctx.page.drawText(text, {
    x: opts.x,
    y: opts.y,
    size: opts.size,
    font,
    color: opts.color ?? COLOR_TEXT,
  })
}

/** Script-routing convenience wrapper. */
export function drawText(ctx: DrawCtx, text: string, opts: DrawOptions & { align?: 'left' | 'right' }): void {
  if (!text) return
  const isHeb = HEBREW_RE.test(text)
  if (isHeb) {
    const align = opts.align ?? 'right'
    if (align === 'right') {
      drawRtl(ctx, text, opts)
    } else {
      const font = opts.bold ? ctx.hebBoldFont : ctx.hebFont
      const reversed = text.split('').reverse().join('')
      ctx.page.drawText(reversed, {
        x: opts.x,
        y: opts.y,
        size: opts.size,
        font,
        color: opts.color ?? COLOR_TEXT,
      })
    }
  } else {
    drawLtr(ctx, text, opts)
  }
}

export function drawHRule(
  ctx: DrawCtx,
  x1: number,
  y: number,
  x2: number,
  color: ReturnType<typeof rgb> = COLOR_RULE_SOFT,
): void {
  ctx.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.5, color })
}

export function drawSectionGap(y: number, amount: number): number {
  return y - amount
}

export function drawSectionDivider(ctx: DrawCtx, y: number, kind: 'soft' | 'firm'): number {
  const color = kind === 'firm' ? COLOR_RULE_FIRM : COLOR_RULE_SOFT
  drawHRule(ctx, MARGIN, y, PAGE_WIDTH - MARGIN, color)
  return y
}

/** Right-anchored Latin number. Errors on Hebrew (formatter regression guard). */
export function drawRightAlignedNumber(
  ctx: DrawCtx,
  text: string,
  rightX: number,
  y: number,
  size: number,
  bold = false,
): void {
  if (HEBREW_RE.test(text)) {
    throw new Error(`billing.pdf.invalid_routing: Hebrew text passed to drawRightAlignedNumber: "${text.slice(0, 60)}"`)
  }
  const font = bold ? ctx.latinBold : ctx.latinFont
  const width = font.widthOfTextAtSize(text, size)
  ctx.page.drawText(text, { x: rightX - width, y, size, font, color: COLOR_TEXT })
}

// ──────────────────────────────── formatters ────────────────────────

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

export function formatMoneyNoSymbol(n: number | string): string {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
