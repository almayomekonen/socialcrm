// @vitest-environment jsdom
/**
 * The billing-centre balance: one number, whole credits, no provider cost, no
 * limit named where credits are not enforced, and nothing charged without an
 * explicit confirmation naming the amount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/credits', () => ({ buyCreditPack: vi.fn(async () => ({ state: 'granted' })) }))

import CreditBalance from '@/components/settings/payment/CreditBalance'
import BillingHistory from '@/components/settings/payment/BillingHistory'
import { buyCreditPack } from '@/actions/credits'
import type { CreditBalanceView } from '@/lib/credits/balanceView'

const view = (over: Partial<CreditBalanceView> = {}): CreditBalanceView => ({
  periodKey: '2026-11', metering: true, enforced: true, canPurchase: true, hasCard: true, freeLimit: 50, freeUsed: 12, purchasedAvailable: 0, exemptThisPeriod: 0, state: 'ok', packs: [], purchases: [], ...over,
})
const PACK = [{ kind: 'credits_200' as const, credits: 200, priceIls: 49 }]
afterEach(() => {
  cleanup()
  vi.mocked(buyCreditPack).mockClear()
})

describe('CreditBalance', () => {
  it('shows the requests used of 50, purchased credits in whole numbers, and no cost', () => {
    const { container } = render(<CreditBalance view={view({ purchasedAvailable: 37.6 })} />)
    expect(screen.getByText('12 מתוך 50 נוצלו החודש')).toBeTruthy()
    expect(screen.getByText('קרדיטים שנרכשו: 37')).toBeTruthy()
    expect(screen.getByText('50 בקשות לעוזר החכם כלולות בכל חודש ומתחדשות בתחילת החודש. אחרי זה בקשות משתמשות בקרדיטים שנרכשו, והצריכה משתנה לפי הפעולה. קרדיטים שנרכשו לא פגים.')).toBeTruthy()
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    expect(container.textContent).not.toMatch(/\$|USD/)
  })

  it('where requests are not limited it names no limit and keeps the plan promise', () => {
    render(<CreditBalance view={view({ enforced: false })} />)
    expect(screen.queryByText(/מתוך 50/)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText(/כלולות בכל חודש/)).toBeNull()
    expect(screen.getByText('AI כלול במסלול שלך ללא הגבלה במצב מהיר ובמצב חכם. השימוש מוצג למעקב בלבד.')).toBeTruthy()
    expect(screen.getByText('מצב מדידה: השימוש נרשם, ושום פעולה לא נחסמת.')).toBeTruthy()
  })

  it('explains an exhausted allowance when requests are limited', () => {
    render(<CreditBalance view={view({ freeUsed: 50, state: 'exhausted' })} />)
    expect(screen.getByRole('status').textContent).toBe('נוצלו כל הבקשות הכלולות החודש ואין קרדיטים. כדי שהעוזר החכם ימשיך לעבוד, אפשר להוסיף קרדיטים. ה-CRM והתזכורות ממשיכים לעבוד כרגיל.')
  })

  it('a link for another account offers nothing to buy', () => {
    render(<CreditBalance view={view({ packs: PACK })} linkMismatch />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('הקישור הזה שייך לחשבון אחר')
  })

  it('charges nothing on the first click: the confirmation names the amount and that it is one-time', async () => {
    render(<CreditBalance view={view({ packs: PACK })} />)
    fireEvent.click(screen.getByRole('button', { name: 'הוסף 200 ב-₪49' }))
    expect(buyCreditPack).not.toHaveBeenCalled()
    expect(screen.getByText('לחייב את הכרטיס השמור ב-₪49 עבור 200 קרדיטים? זה חיוב חד-פעמי, והוא לא מתחדש.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'אשר וחייב ₪49' }))
    await waitFor(() => expect(buyCreditPack).toHaveBeenCalledTimes(1))
    expect(vi.mocked(buyCreditPack).mock.calls[0][0]).toMatchObject({ kind: 'credits_200', requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) })
  })

  it('without a saved card it offers no purchase button', () => {
    render(<CreditBalance view={view({ packs: PACK, hasCard: false })} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('כדי לרכוש קרדיטים צריך כרטיס שמור בחשבון.')).toBeTruthy()
  })
})

describe('BillingHistory', () => {
  it('shows a paid pack with what was bought and its amount; subscription rows stay as they were', () => {
    render(
      <BillingHistory
        charges={[
          { id: 'pack-1', transactionId: 'tx-pack', createdAt: new Date('2026-11-01'), pack: { kind: 'credits_500', credits: 500, amount: 99 } },
          { id: 2, transactionId: 'tx-sub', createdAt: new Date('2026-10-01') },
        ]}
      />,
    )
    fireEvent.click(screen.getByText('צפייה בכל החיובים'))
    expect(screen.getByText('500 קרדיטים · ₪99')).toBeTruthy()
    expect(screen.getByText('tx-sub')).toBeTruthy()
    expect(screen.getAllByText('שולם')).toHaveLength(2)
  })
})
