// @vitest-environment jsdom
/**
 * Registration email — the browser-side half of the fix (the server half lives in
 * addAgency.facebookSub.test.ts).
 *
 * `type='email'` stops "natel" before it is ever submitted and gives phones the @
 * keyboard; `autoComplete='email'` lets the phone offer the saved address, which
 * is what actually prevents a well-formed typo like "natel@gmail.com".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { isValidEmail } from '@/lib/normalizeEmail'

vi.mock('@/actions/agencies', () => ({ addAgency: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import AddAgencyForm from '@/components/agencies/AddAgencyForm'

afterEach(() => cleanup())

describe('registration email field', () => {
  it('is an email input the phone can autofill', () => {
    const { container } = render(<AddAgencyForm />)
    const input = container.querySelector('input[name="email"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.type).toBe('email')
    expect(input.getAttribute('autocomplete')).toBe('email')
    expect(input.required).toBe(true)
  })

  it('keeps the Google-provided address as the default value', () => {
    const { container } = render(<AddAgencyForm defaultEmail='batelcam2@gmail.com' defaultName='Batel' />)
    const input = container.querySelector('input[name="email"]') as HTMLInputElement
    expect(input.value).toBe('batelcam2@gmail.com')
  })
})

describe('isValidEmail', () => {
  it.each(['batelcam2@gmail.com', 'moriyahezi@gmail.com', 'mms@skfp.co.il', 'first.last+crm@studio.io'])(
    'accepts %s',
    (email) => {
      expect(isValidEmail(email)).toBe(true)
    },
  )

  it.each(['natel', '', 'natel@', '@gmail.com', 'natel@gmail', 'natel@gmail.', 'na tel@gmail.com', 'a@b@gmail.com'])(
    'rejects %j',
    (email) => {
      expect(isValidEmail(email)).toBe(false)
    },
  )
})
