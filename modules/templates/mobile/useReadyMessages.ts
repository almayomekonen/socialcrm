'use client'

import { useCallback, useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import { useAdaptivePoll } from '@/modules/inbox/client/useAdaptivePoll'
import { applyTemplateUpdates } from '@/modules/templates/client/applyTemplateUpdates'
import { createTemplate } from '@/actions/whatsapp/templates/createTemplate'
import { retryTemplate } from '@/actions/whatsapp/templates/retryTemplate'
import { archiveTemplate } from '@/actions/whatsapp/templates/archiveTemplate'
import { discardTemplate } from '@/actions/whatsapp/templates/discardTemplate'
import type { Template, TemplateInput } from '@/lib/whatsapp/templates/types'

/**
 * The phone ready-messages list and its mutations (extracted from
 * `ReadyMessagesWorkspace`, no behaviour change): the existing server actions
 * (create / retry / archive / discard), an optimistic row on create, and the
 * adaptive poll while a message waits for WhatsApp's review.
 */
export function useReadyMessages({
  initial,
  retryOf,
  onCreating,
  onRemoved,
}: {
  initial: Template[]
  /** The rejected message being retried, if any (read when the editor submits). */
  retryOf: number | null
  /** The editor closes as soon as the optimistic row is in. */
  onCreating: () => void
  /** A message left the list (archived / discarded). */
  onRemoved: (id: number) => void
}) {
  const [templates, setTemplates] = useState(initial)
  const templatesRef = useRef(templates)
  templatesRef.current = templates
  const hasPending = templates.some((t) => t.status === 'pending')

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/templates', { cache: 'no-store' })
      if (!res.ok) return { changed: false, failed: true }
      const data = (await res.json()) as { templates: Template[] }
      const before = templatesRef.current
      const merged = applyTemplateUpdates(before, data.templates)
      setTemplates((prev) => applyTemplateUpdates(prev, data.templates))
      return { changed: merged !== before, failed: false }
    } catch {
      return { changed: false, failed: true }
    }
  }, [])

  useAdaptivePoll(poll, { enabled: hasPending })

  const handleCreate = (input: TemplateInput) => {
    const tempId = -Date.now()
    const optimistic: Template = {
      id: tempId,
      displayTitle: input.displayTitle.trim(),
      status: 'pending',
      bodyText: input.bodyText.trim(),
      variables: input.variables,
      failureText: null,
      archived: false,
      createdAt: new Date().toISOString(),
    }
    setTemplates((prev) => [optimistic, ...prev])
    onCreating()

    const run = retryOf != null ? retryTemplate(retryOf, input) : createTemplate(input)
    run.then((res) => {
      if (res.ok) {
        setTemplates((prev) =>
          prev.filter((t) => t.id !== retryOf).map((t) => (t.id === tempId ? res.template : t)),
        )
        toast('success', 'ההודעה נוצרה ונשלחה לאישור וואטסאפ')
      } else if ('error' in res) {
        setTemplates((prev) => prev.filter((t) => t.id !== tempId))
        toast('error', res.error)
      }
    })
  }

  const runArchive = async (id: number) => {
    const res = await archiveTemplate(id)
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      onRemoved(id)
      toast('success', 'ההודעה הועברה לארכיון')
    } else if ('error' in res) {
      toast('error', res.error)
    }
  }

  const runDiscard = async (id: number) => {
    const res = await discardTemplate(id)
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      onRemoved(id)
      toast('success', 'ההודעה הוסרה')
    } else if ('error' in res) {
      toast('error', res.error)
    }
  }

  return { templates, handleCreate, runArchive, runDiscard }
}
