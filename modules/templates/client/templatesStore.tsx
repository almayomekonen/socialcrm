'use client'

import { useCallback, useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { useAdaptivePoll } from '@/modules/inbox/client/useAdaptivePoll'
import { applyTemplateUpdates } from './applyTemplateUpdates'
import { createTemplate } from '@/actions/whatsapp/templates/createTemplate'
import type { Template, TemplateInput } from '@/lib/whatsapp/templates/types'
import TemplateList from '@/components/settings/templates/TemplateList'
import TemplatesEmptyState from '@/components/settings/templates/TemplatesEmptyState'
import CreateTemplateModal from '@/components/settings/templates/CreateTemplateModal'

/**
 * Client store + workspace for ready-made messages (mirrors the inbox store's
 * optimistic-merge idea; small useState store — a full context lands in Sprint 4
 * when polling needs to push updates in).
 *
 * Optimistic flow (Sprint 3 contract): on submit an optimistic `pending` row is
 * added to the client store ONLY and the modal closes at once (instant ack). The
 * Server Action runs; on success the temp row reconciles to the confirmed server
 * row, on failure it is rolled back and the mapped Hebrew error is toasted.
 */
export default function TemplatesWorkspace({ initial }: { initial: Template[] }) {
  const [templates, setTemplates] = useState<Template[]>(initial)
  const [createOpen, setCreateOpen] = useState(false)

  // Adaptive poll of the LOCAL endpoint (no Graph) while any row is pending —
  // it just surfaces the webhook/cron's DB writes. Disabled (stops) the moment no
  // pending rows remain, i.e. every template has reached a terminal state.
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
    // Negative temp id — client-only, never collides with a real DB id.
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
    setTemplates((prev) => [optimistic, ...prev]) // appears instantly
    setCreateOpen(false)

    createTemplate(input).then((res) => {
      if (res.ok) {
        setTemplates((prev) => prev.map((t) => (t.id === tempId ? res.template : t))) // reconcile
        toast('success', 'ההודעה נשלחה לבדיקה')
      } else if ('error' in res) {
        setTemplates((prev) => prev.filter((t) => t.id !== tempId)) // rollback
        toast('error', res.error)
      }
    })
  }

  return (
    <div className='grid gap-3'>
      {templates.length === 0 ? (
        <TemplatesEmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <div className='flex justify-end'>
            <Btn
              lbl='הודעה מוכנה חדשה'
              icon='plus'
              size='small'
              className='w-fit'
              onClick={() => setCreateOpen(true)}
            />
          </div>
          <TemplateList templates={templates} />
        </>
      )}
      <CreateTemplateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
    </div>
  )
}
