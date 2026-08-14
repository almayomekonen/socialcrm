// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

const h = vi.hoisted(() => ({
  push: vi.fn(),
  checkFacebookUser: vi.fn(),
  checkUser: vi.fn(),
  login: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, refresh: vi.fn() }),
  unstable_rethrow: (err: unknown) => {
    throw err
  },
}))
vi.mock('next/script', () => ({
  default: function Script({ onLoad }: { onLoad?: () => void }) {
    onLoad?.()
    return null
  },
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/actions/auth', () => ({
  checkFacebookUser: h.checkFacebookUser,
  checkUser: h.checkUser,
}))

import Login from '@/components/auth/Login'

describe('Facebook Login temporary UX gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('google', {
      accounts: { id: { initialize: vi.fn(), renderButton: vi.fn() } },
    })
    ;(window as unknown as { FB: { init: () => void; login: typeof h.login } }).FB = {
      init: vi.fn(),
      login: h.login,
    }
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the coming-soon notice and does not call FB.login when the user is not enabled', () => {
    render(<Login facebookAppId='1576374570608325' facebookLoginAllowed={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'כניסה באמצעות Facebook' }))

    expect(screen.getByText('Facebook Login בקרוב')).toBeInTheDocument()
    expect(screen.getByText(/פותחים את ההתחברות עם Facebook בהדרגה/)).toBeInTheDocument()
    expect(h.login).not.toHaveBeenCalled()
    expect(h.checkFacebookUser).not.toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
  })

  it('keeps FB.login for an enabled Facebook User Login session', () => {
    render(<Login facebookAppId='1576374570608325' facebookLoginAllowed />)

    fireEvent.click(screen.getByRole('button', { name: 'כניסה באמצעות Facebook' }))

    expect(h.login).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Facebook Login בקרוב')).not.toBeInTheDocument()
    expect(h.push).not.toHaveBeenCalled()
  })
})
