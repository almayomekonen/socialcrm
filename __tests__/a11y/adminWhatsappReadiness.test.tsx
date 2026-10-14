// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import WhatsappReadinessView from '@/components/admin/whatsapp/WhatsappReadinessView'
import type { ReadinessView } from '@/lib/whatsapp/platform/readinessView'

afterEach(cleanup)
const EMOJI = /\p{Extended_Pictographic}/u

const view: ReadinessView = {
  ready: false,
  checks: [
    { name: 'token', label: 'טוקן הגישה', ok: true, fields: [{ key: 'isValid', label: 'טוקן תקף', value: true }, { key: 'type', label: 'סוג טוקן', value: 'SYSTEM_USER' }] },
    { name: 'template', label: 'תבנית lead_followup_alert', ok: false, fields: [] },
  ],
}

describe('WhatsappReadinessView', () => {
  it('names every check as a heading-labelled region, with status in text (not colour only)', () => {
    render(<WhatsappReadinessView view={view} checkedAt='14.10.2026' />)
    expect(screen.getByText('לא מוכן לשליחה')).toBeInTheDocument()
    const token = screen.getByRole('region', { name: 'טוקן הגישה' })
    expect(within(token).getByText('תקין')).toBeInTheDocument()
    expect(within(token).getByRole('rowheader', { name: 'טוקן תקף' })).toBeInTheDocument()
    expect(within(token).getByText('כן')).toBeInTheDocument()
    const template = screen.getByRole('region', { name: 'תבנית lead_followup_alert' })
    expect(within(template).getByText('לא תקין')).toBeInTheDocument()
    expect(within(template).getByText('אין פרטים נוספים לבדיקה זו.')).toBeInTheDocument()
  })

  it('says it only reads from Meta, and has no buttons or forms', () => {
    const { container } = render(<WhatsappReadinessView view={view} checkedAt='14.10.2026' />)
    expect(screen.getByText(/קוראת נתונים מ-Meta בלבד ואינה שולחת הודעות/)).toBeInTheDocument()
    expect(container.querySelectorAll('button, form, a').length).toBe(0)
    expect(container.textContent).not.toMatch(EMOJI)
  })

  it('a failed check run is announced as an alert', () => {
    render(<WhatsappReadinessView view={null} checkedAt='14.10.2026' />)
    expect(screen.getByRole('alert')).toHaveTextContent('לא ניתן היה להשלים את בדיקת המוכנות')
  })
})
