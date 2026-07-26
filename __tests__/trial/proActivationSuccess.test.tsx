// @vitest-environment jsdom
//
// Pro activation celebration — one-shot + accessibility contract.
// Pure client, no DB: run with VITEST_NO_DB=1.

import { afterEach, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, act, cleanup } from '@testing-library/react'
import {
  ActivationCelebrationProvider,
  useActivationCelebration,
} from '@/components/trial/ActivationCelebrationContext'
import ProActivationSuccess from '@/components/trial/ProActivationSuccess'

afterEach(cleanup)

function Harness() {
  const { justActivated, markActivated } = useActivationCelebration()
  return (
    <>
      <div data-testid='flag'>{String(justActivated)}</div>
      <button onClick={markActivated}>mark</button>
      <ProActivationSuccess />
    </>
  )
}

function renderHarness() {
  return render(
    <ActivationCelebrationProvider>
      <Harness />
    </ActivationCelebrationProvider>,
  )
}

describe('Pro activation celebration', () => {
  it('a fresh provider (refresh / re-login / navigation) is not activated → surface hidden', () => {
    renderHarness()
    expect(screen.getByTestId('flag').textContent).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('ה־Pro שלך פעיל')).toBeNull()
  })

  it('markActivated (started:true) reveals the premium surface with the approved copy', () => {
    renderHarness()
    act(() => {
      screen.getByText('mark').click()
    })

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-labelledby')).toBe('pro-active-title')
    expect(dialog.getAttribute('aria-describedby')).toBe('pro-active-sub')
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    expect(screen.getByText('ה־Pro שלך פעיל')).toBeTruthy()
    expect(screen.getByText('כל היכולות של SocialCRM Pro פתוחות עבורך ל־7 הימים הקרובים.')).toBeTruthy()
    expect(screen.getByText('AI מתקדם')).toBeTruthy()
    expect(screen.getByText('כל הלידים והשיחות')).toBeTruthy()
    expect(screen.getByText('כל כלי העבודה והאינטגרציות')).toBeTruthy()
    expect(screen.getByText('התחל לעבוד עם Pro')).toBeTruthy()
    expect(screen.getByText('SOCIALCRM PRO')).toBeTruthy()
  })

  it('CTA dismisses and clears the signal (one-shot; will not reappear)', () => {
    renderHarness()
    act(() => {
      screen.getByText('mark').click()
    })
    expect(screen.getByRole('dialog')).toBeTruthy()

    act(() => {
      screen.getByText('התחל לעבוד עם Pro').click()
    })
    expect(screen.getByTestId('flag').textContent).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('close control (X) also dismisses', () => {
    renderHarness()
    act(() => {
      screen.getByText('mark').click()
    })
    act(() => {
      screen.getByLabelText('סגירה').click()
    })
    expect(screen.getByTestId('flag').textContent).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
