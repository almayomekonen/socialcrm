// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import ConsentCard from '@/components/oauth/ConsentCard'
import ConsentMessage from '@/components/oauth/ConsentMessage'
import OAuthLayout from '@/app/oauth/layout'

afterEach(cleanup)

const props = {
  clientName: 'ChatGPT',
  redirectHost: 'chatgpt.com',
  userName: 'דנה',
  agencyName: 'סוכנות דנה',
  scopes: ['crm.leads.read', 'crm.conversations.read'] as ('crm.leads.read' | 'crm.conversations.read')[],
  csrf: 'c'.repeat(32),
}

describe('ConsentCard', () => {
  it('has one h1 naming the client', () => {
    render(<ConsentCard {...props} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ChatGPT')
  })

  it('Allow and Deny are real, labelled submit buttons in one POST form to the consent endpoint', () => {
    const { container } = render(<ConsentCard {...props} />)
    const form = container.querySelector('form')!
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/api/oauth/consent')
    const allow = within(form).getByRole('button', { name: 'אשר חיבור ל-ChatGPT' })
    const deny = within(form).getByRole('button', { name: 'ביטול' })
    for (const [b, v] of [
      [allow, 'approve'],
      [deny, 'deny'],
    ] as const) {
      expect(b.tagName).toBe('BUTTON')
      expect(b).toHaveAttribute('type', 'submit')
      // Without JavaScript the button itself carries the decision; hydrated, the
      // hidden input does (see ConsentDecisionForm).
      expect(b).toHaveAttribute('data-decision', v)
      expect(b).toHaveAttribute('name', 'decision')
      expect(b).toHaveAttribute('value', v)
      expect(b).not.toBeDisabled()
      expect(b).not.toHaveAttribute('tabindex', '-1')
    }
    expect(container.querySelector('input[type="hidden"][name="csrf"]')).toHaveValue('c'.repeat(32))
    expect(container.querySelector('input[type="hidden"][name="decision"]')).toBeDisabled()
  })

  it('shows the redirect host, the account context and the scopes in plain language', () => {
    render(<ConsentCard {...props} />)
    expect(screen.getByText(/chatgpt\.com/)).toBeInTheDocument()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText('סוכנות דנה')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('states what is NOT granted and never implies phone, email, write or sending access', () => {
    const { container } = render(<ConsentCard {...props} />)
    expect(screen.getByText(/לא יקבל מספרי טלפון או כתובות אימייל/)).toBeInTheDocument()
    expect(screen.getByText(/לא יוכל לשנות נתונים/)).toBeInTheDocument()
    expect(screen.getByText(/לא ישלח הודעות/)).toBeInTheDocument()
    const granted = Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '')
    for (const line of granted) {
      for (const w of ['טלפון', 'אימייל', 'לשנות', 'לשלוח', 'לעדכן']) expect(line).not.toContain(w)
    }
  })

  it('does not render the raw redirect URI or the csrf value as visible text', () => {
    const { container } = render(<ConsentCard {...props} />)
    expect(container.textContent).not.toContain('connector_platform_oauth_redirect')
    expect(container.textContent).not.toContain('c'.repeat(32))
  })
})

describe('ConsentMessage', () => {
  it('has a heading, the message and a labelled way back', () => {
    render(<ConsentMessage message='בקשת החיבור פגה.' />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByText('בקשת החיבור פגה.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'חזרה ל-SocialCRM' })).toHaveAttribute('href', '/dashboard')
  })

  it('links to billing when access is the problem', () => {
    render(<ConsentMessage message='x' showBilling />)
    expect(screen.getByRole('link', { name: 'לניהול המנוי' })).toHaveAttribute('href', '/settings/update_payment')
  })
})

describe('oauth layout', () => {
  it('owns exactly one <main> landmark', () => {
    const { container } = render(<OAuthLayout>content</OAuthLayout>)
    expect(container.querySelectorAll('main')).toHaveLength(1)
  })
})

describe('client-aware consent copy', () => {
  it('Claude: heading and approve button name Claude; ChatGPT appears nowhere', () => {
    const { container } = render(<ConsentCard {...props} clientName='Claude' redirectHost='claude.ai' />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('חיבור Claude ל-SocialCRM')
    expect(screen.getByRole('button', { name: 'אשר חיבור ל-Claude' })).toBeInTheDocument()
    expect(screen.getByText('claude.ai')).toBeInTheDocument()
    expect(container.textContent).not.toContain('ChatGPT')
  })

  it('ConsentMessage names the client when known, and is neutral otherwise', () => {
    const { unmount } = render(<ConsentMessage message='x' clientName='Claude' />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('חיבור Claude ל-SocialCRM')
    unmount()
    render(<ConsentMessage message='x' />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('חיבור אפליקציה ל-SocialCRM')
  })
})
