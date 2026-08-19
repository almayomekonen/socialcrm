// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  unstable_rethrow: () => {},
}))
vi.mock('next/script', () => ({
  default: () => null,
}))
vi.mock('@/actions/auth', () => ({
  checkUser: vi.fn(),
  checkFacebookUser: vi.fn(),
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

import Login from '@/components/auth/Login'

afterEach(cleanup)

describe('mobile social login alignment', () => {
  it('Google and Facebook share the same LTR icon+label structure', () => {
    render(<Login matchSocialButtons facebookAppId='123' />)
    const row = screen.getByTestId('social-auth-buttons')
    expect(row.getAttribute('dir')).toBe('ltr')
    const googleIcon = row.querySelector('svg')
    const facebookBtn = screen.getByRole('button', { name: 'כניסה באמצעות Facebook' })
    const facebookIcon = facebookBtn.querySelector('svg')
    expect(googleIcon?.getAttribute('class')).toContain('left-3')
    expect(facebookIcon?.getAttribute('class')).toContain('left-3')
    expect(facebookBtn.className).toContain('h-11')
    expect(facebookBtn.className).toContain('w-[250px]')
  })

  it('preserves the signed-in Google account line when a user is present', () => {
    render(<Login matchSocialButtons user={{ name: 'דני לוי', gglName: 'Danny' }} facebookAppId='123' />)
    expect(screen.getByText(/כניסה בשם/)).toBeTruthy()
  })
})

describe('desktop login presentation is unchanged', () => {
  it('default Login still exposes the GIS button without the mobile overlay', () => {
    render(<Login facebookAppId='123' />)
    expect(screen.queryByTestId('social-auth-buttons')).toBeNull()
    expect(document.getElementById('gglBtn')?.className).not.toContain('opacity-0')
    expect(screen.getByRole('button', { name: 'כניסה באמצעות Facebook' }).className).toContain('h-10')
  })

  it('auth pages only match buttons on the phone entity', () => {
    const auth = fs.readFileSync(path.join(process.cwd(), 'app/(auth)/auth/page.tsx'), 'utf8')
    expect(auth).toContain('matchSocialButtons={phoneLogin}')
    expect(auth).toContain('isMobileRequest')
    const login = fs.readFileSync(path.join(process.cwd(), 'components/auth/Login.tsx'), 'utf8')
    expect(login).toContain("getElementById('gglBtn')")
    expect(login).toContain('checkUser')
    expect(login).toContain('checkFacebookUser')
  })
})
