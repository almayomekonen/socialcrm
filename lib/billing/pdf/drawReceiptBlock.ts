/**
 * Receipt block for combined invoice/receipt (חשבונית/קבלה) documents.
 *
 * Sits between the totals panel and the customer footer. Reads ONLY
 * from the issued invoice's payment snapshot columns — never from the
 * live (mutable) payment fields. Historical integrity is the doctrine
 * of the entire PDF pipeline; the renderer is a projection of frozen
 * snapshots, not of current state.
 *
 * Visual language matches the totals panel: a subtle-fill panel anchored
 * to the right margin, three label/value rows (method / amount / date),
 * each rendered with the same RTL-label + LTR-value pattern used
 * throughout the document. No "RECEIPT" header banner — the document
 * title at the top already announces "חשבונית מס/קבלה". This block is
 * the data, not the announcement.
 */

import type { BillInvoiceRow } from '@/db/billing/invoices'
import { paymentMethodLabel } from '@/lib/billing/payment/methods'
import {
  COLOR_LABEL,
  COLOR_PANEL_FILL,
  MARGIN,
  PAGE_WIDTH,
  SP,
  TYPE,
  drawHRule,
  drawRightAlignedNumber,
  drawRtl,
  drawSectionGap,
  formatDate,
  formatMoneyNoSymbol,
  type DrawCtx,
} from './primitives'

/**
 * Decides whether to render the block. The renderer calls this so the
 * "should I draw?" gate stays out of the orchestration in renderInvoicePdf.ts.
 */
export function shouldDrawReceiptBlock(invoice: BillInvoiceRow): boolean {
  if (invoice.kind !== 'invoice_receipt') return false
  if (!invoice.paymentReceived) return false
  if (!invoice.paymentMethodSnapshot) return false
  return true
}

/**
 * Renders the receipt summary. Returns the new y cursor (bottom edge
 * of the panel), matching the convention of every other drawer.
 */
export function drawReceiptBlock(ctx: DrawCtx, invoice: BillInvoiceRow, yStart: number): number {
  const PANEL_RIGHT = PAGE_WIDTH - MARGIN
  const PANEL_WIDTH = 250
  const PANEL_LEFT = PANEL_RIGHT - PANEL_WIDTH
  const PAD_X = SP.LG
  const PAD_Y = SP.LG

  const LABEL_RIGHT_X = PANEL_RIGHT - PAD_X
  const VALUE_RIGHT_X = LABEL_RIGHT_X - 90

  const titleRow = SP.LG
  const dataRow = SP.LG
  const dividerSpace = SP.MD
  const contentHeight = titleRow + dividerSpace + dataRow * 3
  const panelHeight = contentHeight + PAD_Y * 2

  const panelTop = yStart
  const panelBottom = panelTop - panelHeight

  ctx.page.drawRectangle({
    x: PANEL_LEFT,
    y: panelBottom,
    width: PANEL_WIDTH,
    height: panelHeight,
    color: COLOR_PANEL_FILL,
  })

  // Eyebrow inside the panel. Mirrors the muted, uppercase labels used
  // elsewhere; keeps this block calm — same family as the totals panel.
  let y = panelTop - PAD_Y - TYPE.LABEL
  drawRtl(ctx, 'קבלה — תשלום שהתקבל', {
    x: LABEL_RIGHT_X,
    y,
    size: TYPE.LABEL,
    color: COLOR_LABEL,
  })
  y = drawSectionGap(y, dividerSpace)
  drawHRule(ctx, PANEL_LEFT + PAD_X, y + SP.SM, LABEL_RIGHT_X)
  y -= titleRow

  // Method
  drawRtl(ctx, 'אמצעי תשלום', { x: LABEL_RIGHT_X, y, size: TYPE.METADATA, color: COLOR_LABEL })
  drawRtl(ctx, paymentMethodLabel(invoice.paymentMethodSnapshot) || invoice.paymentMethodSnapshot, {
    x: VALUE_RIGHT_X,
    y,
    size: TYPE.METADATA,
  })
  y -= dataRow

  // Amount — LTR number, same column rules as the totals panel.
  drawRtl(ctx, 'סכום', { x: LABEL_RIGHT_X, y, size: TYPE.METADATA, color: COLOR_LABEL })
  if (invoice.paymentAmountSnapshot != null) {
    drawRightAlignedNumber(ctx, formatMoneyNoSymbol(invoice.paymentAmountSnapshot), VALUE_RIGHT_X, y, TYPE.METADATA)
  }
  y -= dataRow

  // Date — LTR DD/MM/YYYY, same formatter used for the issue/due dates.
  drawRtl(ctx, 'תאריך תשלום', { x: LABEL_RIGHT_X, y, size: TYPE.METADATA, color: COLOR_LABEL })
  if (invoice.paymentDateSnapshot) {
    drawRightAlignedNumber(ctx, formatDate(invoice.paymentDateSnapshot), VALUE_RIGHT_X, y, TYPE.METADATA)
  }

  return panelBottom
}
