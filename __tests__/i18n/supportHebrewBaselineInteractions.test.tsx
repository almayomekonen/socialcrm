// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { resetTrialSupportEnv, trialSupportEnv as env } from './trialSupportEnv'

/**
 * HEBREW BASELINE, part 2 (i18n Phase F5): the support centre's client
 * controls — the request form (sent, every refusal code, an unknown code, the
 * pending label, the optional-body variant), the reply box (resolved note,
 * pending, refusal, sent) and the guide search (pending, submit with / without
 * a query). Records the DOM after each step AND every action argument /
 * navigation / toast, so the behaviour tests can replay them in en / ar.
 * Recorded BEFORE Phase F5.
 */

vi.mock('next/navigation', async () => (await import('./trialSupportMocks')).navigationModule())
vi.mock('@/actions/support/requests', async () => (await import('./trialSupportMocks')).supportActionsModule())
vi.mock('@/lib/toast', async () => (await import('./trialSupportMocks')).toastModule())

afterEach(() => {
  cleanup()
  resetTrialSupportEnv()
})

const never = () => new Promise(() => {})
const CODES = ['forbidden', 'not_found', 'invalid_subject', 'invalid_body', 'invalid_category', 'rate_limited', 'mystery']

async function submit(form: HTMLFormElement) {
  await act(async () => {
    fireEvent.submit(form)
  })
}

describe('Hebrew baseline — the support request form', () => {
  test('sent, every refusal, pending, optional body', async () => {
    const { default: Form } = await import('@/components/support/SupportRequestForm')
    const out: Record<string, unknown> = {}
    for (const kind of ['problem', 'question'] as const) {
      const { container, unmount } = render(<Form kind={kind} fieldLabel={kind === 'problem' ? 'מה קרה?' : 'מה השאלה?'} />)
      out[`${kind} — idle`] = container.innerHTML
      fireEvent.change(container.querySelector('textarea')!, { target: { value: 'הוואטסאפ לא מתחבר' } })
      await submit(container.querySelector('form')!)
      out[`${kind} — sent`] = container.innerHTML
      unmount()
    }
    for (const reason of CODES) {
      env.createResult = { ok: false, reason }
      const { container, unmount } = render(<Form kind='problem' />)
      await submit(container.querySelector('form')!)
      out[`refusal — ${reason}`] = container.innerHTML
      unmount()
    }
    env.createResult = never
    const pending = render(<Form kind='problem' />)
    await submit(pending.container.querySelector('form')!)
    out.pending = pending.container.innerHTML
    pending.unmount()
    out.optional = render(<Form kind='problem' bodyOptional />).container.innerHTML
    expect(out).toMatchSnapshot('dom')
    expect(env.calls).toMatchSnapshot('calls')
  })
})

describe('Hebrew baseline — the reply box', () => {
  test('open / resolved, sent, refusal, pending', async () => {
    const { default: Reply } = await import('@/components/support/SupportReplyBox')
    const out: Record<string, unknown> = {}
    out.open = render(<Reply requestId={41} isResolved={false} />).container.innerHTML
    cleanup()
    const { container, unmount } = render(<Reply requestId={41} isResolved />)
    out.resolved = container.innerHTML
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'עדיין לא עובד' } })
    await submit(container.querySelector('form')!)
    out.sent = container.innerHTML
    unmount()
    for (const reason of CODES) {
      env.replyResult = { ok: false, reason }
      const r = render(<Reply requestId={41} isResolved={false} />)
      await submit(r.container.querySelector('form')!)
      out[`refusal — ${reason}`] = r.container.innerHTML
      r.unmount()
    }
    env.replyResult = never
    const p = render(<Reply requestId={41} isResolved={false} />)
    await submit(p.container.querySelector('form')!)
    out.pending = p.container.innerHTML
    expect(out).toMatchSnapshot('dom')
    expect(env.calls).toMatchSnapshot('calls')
  })
})

describe('Hebrew baseline — the guide search', () => {
  test('submit with and without a query', async () => {
    const { default: Search } = await import('@/components/support/SupportSearch')
    const { container } = render(<Search initialQuery='whatsapp' />)
    const idle = container.innerHTML
    await submit(container.querySelector('form')!)
    fireEvent.change(container.querySelector('input')!, { target: { value: '  ' } })
    await submit(container.querySelector('form')!)
    expect({ idle }).toMatchSnapshot('dom')
    expect(env.calls).toMatchSnapshot('calls')
  })
})
