// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/actions/autoResponse/updateSettings', () => ({
  updateAutoResponseSettings: vi.fn(),
}))
vi.mock('@/lib/btns/Btn', () => ({
  Btn: ({ lbl }: { lbl: string }) => <button type='button'>{lbl}</button>,
}))
vi.mock('@/lib/Icon', () => ({
  default: () => <span />,
}))
vi.mock('@/lib/form', () => ({
  Switch: ({
    checked,
    onChange,
    'aria-label': ariaLabel,
  }: {
    checked: boolean
    onChange: (e: { target: { checked: boolean } }) => void
    'aria-label'?: string
  }) => (
    <input
      type='checkbox'
      aria-label={ariaLabel}
      checked={checked}
      onChange={(e) => onChange({ target: { checked: e.target.checked } })}
    />
  ),
}))

import AutoResponseSettingsForm from '@/components/settings/autoResponse/AutoResponseSettingsForm'

const props = {
  masterEnabled: true,
  channelEnabled: true,
  dailyCap: 200,
  guidance: null as string | null,
  agentInstructions: null as string | null,
  businessName: 'מוסך אלון',
  replyMode: 'ai' as const,
  fixedBody: null as string | null,
}

describe('AutoResponseSettingsForm delay field', () => {
  it('shows the stored delaySeconds value, not a hardcoded 0', () => {
    render(<AutoResponseSettingsForm {...props} delaySeconds={5} />)
    const input = screen.getByLabelText('המתנה לפני שליחה') as HTMLInputElement
    expect(input.value).toBe('5')
  })

  it('shows 0 when the stored delay is 0', () => {
    render(<AutoResponseSettingsForm {...props} delaySeconds={0} />)
    const input = screen.getByLabelText('המתנה לפני שליחה') as HTMLInputElement
    expect(input.value).toBe('0')
  })
})

describe('AutoResponseSettingsForm with the questionnaire active', () => {
  it('hides the agent reply style but keeps the master switch and the selector slot', () => {
    render(<AutoResponseSettingsForm {...props} delaySeconds={0} agentSettingsVisible={false} responderSlot={<div data-testid='slot' />} />)
    expect(screen.getByTestId('slot')).toBeTruthy()
    expect(screen.getByLabelText('מענה אוטומטי בוואטסאפ')).toBeTruthy()
    expect(screen.getByText('הגדרות הסוכן מוסתרות כי השאלון פעיל. הן נשמרות כמו שהן.')).toBeTruthy()
  })

  it('agent active (default): no hidden-settings note', () => {
    render(<AutoResponseSettingsForm {...props} delaySeconds={0} />)
    expect(screen.queryByText(/הגדרות הסוכן מוסתרות/)).toBeNull()
  })
})
