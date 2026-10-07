/**
 * Bring a question card into view and put the cursor where the owner should
 * act: the first field marked invalid, else the question text. Used by the
 * publish problems list and by "אחר" pointing at its follow-up.
 */
export const cardDomId = (key: string) => `questionnaire-q-${key}`

export function focusCard(key: string): void {
  const card = document.getElementById(cardDomId(key))
  if (!card) return
  card.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  const target =
    card.querySelector<HTMLElement>('[aria-invalid="true"]') ?? card.querySelector<HTMLElement>('textarea, input, select')
  target?.focus({ preventScroll: true })
}
