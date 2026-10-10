/**
 * How long an answer option's label may be, and when it still fits WhatsApp's
 * tap-to-select formats. Shared by the runtime definition, the Builder model,
 * the editor and the interactive sender, so all four agree.
 *
 * Two different limits, on purpose:
 *  · OPTION_LABEL_MAX (40) is what the questionnaire accepts. Any label up to
 *    it can always be sent, because a choice question's fallback is the
 *    numbered text menu ("1. באמצעות Excel או Google Sheets").
 *  · WHATSAPP_LIST_ROW_TITLE_MAX (24) is Meta's list row title limit
 *    (interactive.ts has the reference). A question with a longer label is sent
 *    as the numbered text menu instead of a list or buttons; the limit itself
 *    is never bypassed.
 */
export const OPTION_LABEL_MAX = 40
export const WHATSAPP_LIST_ROW_TITLE_MAX = 24

/** Whether this label can be a WhatsApp list row (measured as it is stored: trimmed). */
export function fitsWhatsappList(label: string): boolean {
  return label.trim().length <= WHATSAPP_LIST_ROW_TITLE_MAX
}
