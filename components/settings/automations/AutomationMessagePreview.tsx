'use client'

import { useEffect, useState } from 'react'
import { previewAutomationMessage } from '@/actions/automations/previewMessage'
import { errorMessage as msg } from './sheetOptions'

/**
 * The Builder preview for a MESSAGE action — the real resolver, not an
 * approximation.
 *
 * The email pane's lesson applied to the second channel: it renders through the
 * executor, so the text shown here is produced by the same code that produces the
 * text Meta receives. The old message branch substituted variables locally and
 * could therefore drift from the send.
 *
 * Rendered as a chat bubble rather than in an iframe, because a WhatsApp message
 * carries no document of its own — it is text, and the app's own typography is
 * the honest way to show text.
 */

const DEBOUNCE_MS = 350

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; text: string; notApproved: boolean }
  | { kind: 'error'; message: string }

export default function AutomationMessagePreview({
  templateId,
  bindings,
}: {
  templateId: string
  bindings: Record<string, string>
}) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  // Serialised so the effect re-runs when a mapping changes, not on every render
  // of an equal object.
  const bindingsKey = JSON.stringify(bindings)

  useEffect(() => {
    if (!templateId) {
      setState({ kind: 'idle' })
      return
    }
    let cancelled = false
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }))

    const timer = setTimeout(async () => {
      const res = await previewAutomationMessage({ templateId, templateBindings: JSON.parse(bindingsKey) })
      if (cancelled) return
      if (res.ok === false) return setState({ kind: 'error', message: msg(res.reason) })
      if (res.shape !== 'message') return setState({ kind: 'error', message: msg('action_invalid') })
      setState({ kind: 'ready', text: res.text, notApproved: res.notApproved ?? false })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [templateId, bindingsKey])

  if (state.kind === 'idle') {
    return <p className='text-sm text-gray-600'>אחרי שתבחר הודעה מוכנה, כאן יופיע מה שהליד יקבל.</p>
  }

  if (state.kind === 'error') {
    return (
      <p className='text-sm text-red-600' role='alert'>
        {state.message}
      </p>
    )
  }

  if (state.kind === 'loading') {
    return (
      <div className='grid gap-2' aria-hidden='true'>
        <div className='h-4 w-1/2 rounded bg-gray-100' />
        <div className='h-4 w-2/3 rounded bg-gray-100' />
      </div>
    )
  }

  return (
    <div className='grid gap-2'>
      <div className='max-w-[85%] rounded-lg rounded-ss-none bg-white border border-gray-200 px-3 py-2'>
        <p className='text-sm text-gray-800 whitespace-pre-line'>{state.text || 'ללא תוכן'}</p>
      </div>
      {state.notApproved && (
        <p className='text-sm text-amber-700' role='alert'>
          ההודעה הזו אינה מאושרת כרגע ולא תישלח.
        </p>
      )}
    </div>
  )
}
