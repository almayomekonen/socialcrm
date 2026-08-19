// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/actions/whatsapp/promoteConversationToLead', () => ({
  promoteConversationToLead: vi.fn(),
  listConversationLeadMatches: vi.fn(),
  linkConversationToExistingLead: vi.fn(),
}))
vi.mock('@/actions/whatsapp/markConversationPersonal', () => ({
  markConversationPersonal: vi.fn(),
}))

import LeadlessConversationActions from '@/components/inbox/LeadlessConversationActions'

afterEach(cleanup)

describe('LeadlessConversationActions tones', () => {
  it('desktop default stays gray-on-white, not WhatsApp-header white', () => {
    render(<LeadlessConversationActions conversationId={1} isPersonal={false} />)
    const create = screen.getByRole('button', { name: /צור ליד/ })
    expect(create.className).toContain('text-gray-600')
    expect(create.className).not.toContain('text-white')
  })

  it('onGreen chips are white on the WhatsApp header, not inherited gray', () => {
    render(<LeadlessConversationActions conversationId={1} isPersonal={false} tone='onGreen' />)
    const create = screen.getByRole('button', { name: /צור ליד/ })
    const link = screen.getByRole('button', { name: 'קשר לליד קיים' })
    const personal = screen.getByRole('button', { name: 'סמן כאישי' })
    for (const btn of [create, link, personal]) {
      expect(btn.className).toContain('text-white')
      expect(btn.className).not.toContain('text-gray-600')
      expect(btn.className).not.toContain('text-error')
      expect(btn.tagName).toBe('BUTTON')
    }
  })

  it('desktop conversation header does not opt into onGreen', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/summary/WhatsappConversationHeader.tsx'), 'utf8')
    expect(src).not.toContain("tone='onGreen'")
    expect(src).not.toContain('tone="onGreen"')
  })
})
