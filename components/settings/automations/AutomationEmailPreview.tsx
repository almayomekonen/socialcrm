'use client'

import { useEffect, useState } from 'react'
import { previewAutomationEmail } from '@/actions/automations/previewEmail'
import { errorMessageIn } from './sheetOptions'
import { customerTextAttrs } from '@/lib/i18n/config'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The Builder preview: the REAL rendered email, from the same renderer that
 * sends it.
 *
 * Rendered server-side and shown in a sandboxed iframe. The iframe is the point
 * — the email carries its own document, direction, fonts and dark-mode rules,
 * and dropping that markup into the app's DOM would let app styles leak in and
 * show the customer something the recipient will never see. `sandbox` with no
 * allowances means the preview cannot navigate, script, or submit.
 *
 * Debounced rather than per-keystroke: this is a server round-trip, and the
 * preview is a reading surface, not a live-typing effect.
 */

const DEBOUNCE_MS = 450

type Draft = { subject: string; body: string; ctaLabel: string | null; ctaUrl: string | null }
type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; html: string; subjectLine: string; fromName: string }
  | { kind: 'error'; message: string }

export default function AutomationEmailPreview({ draft }: { draft: Draft }) {
  const t = useT()
  const msg = (reason: string) => errorMessageIn(reason, t.locale)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const { subject, body, ctaLabel, ctaUrl } = draft

  useEffect(() => {
    if (!subject.trim() && !body.trim()) {
      setState({ kind: 'idle' })
      return
    }

    let cancelled = false
    // Keep the previous render visible while the next one is in flight: blanking
    // the pane on every edit would make the panel flicker as the customer types.
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }))

    const timer = setTimeout(async () => {
      const res = await previewAutomationEmail({ subject, body, ctaLabel, ctaUrl })
      if (cancelled) return
      if (res.ok === false) return setState({ kind: 'error', message: msg(res.reason) })
      // This pane renders an email document in an iframe; a message-shaped
      // preview belongs to its own pane. Checking the discriminant rather than
      // assuming is what keeps that separation honest.
      if (res.shape !== 'email') return setState({ kind: 'error', message: msg('action_invalid') })
      setState({ kind: 'ready', html: res.html, subjectLine: res.subjectLine, fromName: res.fromName })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [subject, body, ctaLabel, ctaUrl])

  if (state.kind === 'idle') {
    return <p className='text-sm text-gray-600'>{t('admin.automationSheet.preview.emailIdle')}</p>
  }

  if (state.kind === 'error') {
    return <p className='text-sm text-red-600'>{state.message}</p>
  }

  if (state.kind === 'loading') {
    // Content-shaped placeholder, matching the pane it becomes.
    return (
      <div className='grid gap-2' aria-hidden='true'>
        <div className='h-4 w-2/3 rounded bg-gray-100' />
        <div className='h-64 w-full rounded bg-gray-100' />
      </div>
    )
  }

  return (
    <div className='grid gap-2'>
      {/* The inbox row, shown honestly: the From name the recipient sees sits
          beside the subject, so a subject that repeats the business name is
          visible as the duplication it is. */}
      <div className='grid gap-0.5 text-sm'>
        <span className='font-semibold text-gray-800' {...(state.subjectLine ? customerTextAttrs(t.locale) : {})}>
          {state.subjectLine || t('admin.automationSheet.preview.noSubject')}
        </span>
        <span className='text-gray-500'>{t('admin.automationSheet.preview.from', { name: state.fromName })}</span>
      </div>
      <iframe
        title={t('admin.automationSheet.preview.frameTitle')}
        srcDoc={state.html}
        sandbox=''
        className='h-80 w-full rounded-md border border-gray-200 bg-white'
      />
    </div>
  )
}
