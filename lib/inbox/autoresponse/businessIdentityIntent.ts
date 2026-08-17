/**
 * Who-we-are / how-they-found-us. Classifier + prompt share this so identity
 * questions never fall through to customer DISCOVERY.
 */
const BUSINESS_IDENTITY_RE: RegExp[] = [
  /במה אתם עוסק/,
  /מה אתם עושים/,
  /מה אתם מציעים/,
  /איזה שירותים/,
  /מה השירותים/,
  /הגעתי מהמודע/,
  /הגעתי מהפרסו/,
  /מה אתם מוכרים/,
  /what do you (do|offer|sell)/i,
  /what (services|products) do you/i,
  /i (came from|saw|found) (your )?(ad|ads|advert)/i,
]

export function isBusinessIdentityQuestion(text: string): boolean {
  return BUSINESS_IDENTITY_RE.some((re) => re.test(text ?? ''))
}
