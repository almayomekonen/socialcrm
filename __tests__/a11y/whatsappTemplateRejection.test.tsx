// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const { useAdaptivePoll } = vi.hoisted(() => ({ useAdaptivePoll: vi.fn() }))
vi.mock('@/modules/inbox/client/useAdaptivePoll', () => ({ useAdaptivePoll }))
vi.mock('@/actions/whatsapp/templates/createTemplate', () => ({ createTemplate: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import TemplateRejectionNotice from '@/components/settings/templates/TemplateRejectionNotice'
import TemplateRow from '@/components/settings/templates/TemplateRow'
import TemplatesWorkspace from '@/modules/templates/client/templatesStore'
import type { Template } from '@/lib/whatsapp/templates/types'

afterEach(() => {
  cleanup()
  useAdaptivePoll.mockReset()
})

const tpl = (status: Template['status'], failureText: string | null = null): Template => ({
  id: 1,
  displayTitle: 'תזכורת',
  status,
  bodyText: 'תוכן',
  variables: [],
  failureText,
  archived: false,
  createdAt: '2026-07-23T00:00:00Z',
})

describe('TemplateRejectionNotice', () => {
  it('surfaces the mapped Hebrew reason (never a raw code)', () => {
    render(<TemplateRejectionNotice failureText='ההודעה לא אושרה — התוכן נוגד את המדיניות.' />)
    const box = screen.getByRole('status')
    expect(box).toHaveTextContent('ההודעה לא אושרה — התוכן נוגד את המדיניות.')
    expect(box.textContent).not.toMatch(/[A-Z]{4,}/)
  })
})

describe('TemplateRow — rejection reason', () => {
  it('shows the reason for a rejected row', () => {
    render(<TemplateRow template={tpl('rejected', 'הניסוח לא תקין. כדאי לפשט.')} />)
    expect(screen.getByText('נדחתה')).toBeInTheDocument()
    expect(screen.getByText(/הניסוח לא תקין/)).toBeInTheDocument()
  })

  it('shows no rejection box for an approved row', () => {
    render(<TemplateRow template={tpl('approved')} />)
    expect(screen.getByText('מוכנה לשליחה')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('TemplatesWorkspace — poll gating (stops on terminal)', () => {
  it('enables the poll while a row is pending', () => {
    render(<TemplatesWorkspace initial={[tpl('pending')]} />)
    expect(useAdaptivePoll).toHaveBeenCalled()
    const opts = useAdaptivePoll.mock.calls[0][1]
    expect(opts).toMatchObject({ enabled: true })
  })

  it('disables the poll when every row is terminal', () => {
    render(<TemplatesWorkspace initial={[tpl('approved')]} />)
    const opts = useAdaptivePoll.mock.calls[0][1]
    expect(opts).toMatchObject({ enabled: false })
  })
})
