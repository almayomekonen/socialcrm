import { describe, expect, it } from 'vitest'
import { changesDocument } from '@/lib/waAssistant/smartbee/staleCard'

/** Which owner messages void a pending SmartBee card. Pure (no DB call). */
describe('changesDocument', () => {
  it.each([
    'לא, 2000',
    'בעצם 1700',
    '2000',
    '1,500',
    '₪2000',
    '2000 שקל',
    'בעצם באשראי',
    'כולל מע"מ',
    'לא, חשבונית מס',
    'תפיק קבלה אחרת',
    'לא, צילום חתונה 2026',
    'המסמך לא הופק, ובעצם הסכום 2000 שקל',
  ])('a genuine change voids the card: "%s"', (text) => expect(changesDocument(text)).toBe(true))

  it.each([
    'המסמך לא הופק',
    'המסמך לא קיים',
    'המסמך הופק, מספר 1045',
    'המסמך כן הופק מס׳ 20031',
    'כמה לידים נכנסו ב-2025?',
    'מה יש לי היום ב-14:00',
    'תודה',
    'אוקיי',
  ])('an unrelated message leaves the card alone: "%s"', (text) => expect(changesDocument(text)).toBe(false))
})
