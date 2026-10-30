'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast, proToast } from '@/lib/toast'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import type { RequirementContext } from '@/lib/automations/requirements'
import type { Connection } from '@/lib/automations/catalog/types'
import type { IdentityProblem } from '@/lib/automations/identity'
import type { DefinitionStatus } from '@/db/automations/definitions'
import { duplicateAutomation, setAutomationStatus } from '@/actions/automations/manage'
import { listActivityForAutomationAction } from '@/actions/automations/activity'
import type { AutomationCardData } from './AutomationCard'
import AutomationControlCenter from './AutomationControlCenter'
import AutomationTemplatesSection from './AutomationTemplatesSection'
import type { TemplateView } from '@/lib/automations/templates/overview'
import { DASHBOARD_DEMO } from '@/lib/automations/dashboardDemo'
import { applyFilters, NO_FILTERS } from './automationsDerive'
import AutomationSheet, { type SheetDraft } from './AutomationSheet'
import { BLANK } from './automationDrafts'
import ActivityLogModal, { type ActivityRow } from './ActivityLogModal'

/**
 * The אוטומציות workspace: a library and a control centre, divided by one
 * hairline. Still a thin orchestrator — it owns which sheet or modal is open,
 * and the one piece of state the two panes share.
 *
 * THAT SHARED STATE IS THE SEARCH. A single box filters templates on the left
 * and installed automations on the right, which is why the query lives here
 * rather than inside the library. It replaced a four-control toolbar (search,
 * status, channel, trigger) that sat above a list which is now a short column
 * in a 376px panel — three dropdowns over four rows is furniture, not filtering.
 *
 * The library IS the empty state: someone with no automations sees the same
 * screen they will use forever, so there is nothing to learn twice.
 */

type Props = {
  requirementContext: RequirementContext
  connections: Connection[]
  automations: AutomationCardData[]
  /** Installable templates — the library's contents. */
  templates: TemplateView[]
  drafts: Record<number, SheetDraft>
  /** Consuming runs since the start of the business day. Measured, not derived. */
  todayRuns: number
  previewName: string | null
  identityProblem: IdentityProblem | null
  observationMode: boolean
}

export default function AutomationsSettings({
  requirementContext,
  connections,
  automations,
  templates,
  drafts,
  previewName,
  identityProblem,
  observationMode,
}: Props) {
  const router = useRouter()
  const t = useT()
  const region = useRegionAttrs()
  /** Entitlement from the shared context — the same answer the server gives. */
  const expired = useAccessDenied()
  const [sheet, setSheet] = useState<SheetDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AutomationCardData | null>(null)
  const [log, setLog] = useState<{ name: string; rows: ActivityRow[] } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [, startTransition] = useTransition()

  // One clock for every child, so no two rows disagree about "לפני 2 ש׳".
  const now = useMemo(() => Date.now(), [])
  const visible = useMemo(() => applyFilters(automations, { ...NO_FILTERS, q: query }), [automations, query])

  /**
   * §5: a toggle is undoable for 5s. `undoId`/`undoFrom` are passed only by the
   * toggle call site; every other action keeps the plain 3s confirmation it had.
   * The undo simply re-issues the existing status action — no new endpoint.
   */
  /**
   * A lapsed subscription is answered BEFORE anything happens: no action is
   * called, no busy state is set, the toggle does not move, nothing is
   * persisted and nothing is queued. The automation's own `enabled` state is
   * never touched, because entitlement governs EXECUTION, not what the
   * customer configured.
   *
   * The reply is a billing prompt rather than a failure. Left to run, the
   * guarded action threw and Next surfaced it on the segment error boundary as
   * "חלה שגיאה במערכת", which told the customer their product was broken when
   * in fact their subscription had simply ended.
   */
  const proPrompt = () =>
    proToast({
      title: t('admin.automations.pro.title'),
      body: t('admin.automations.pro.body'),
      source: 'automations_action',
    })

  const run = (
    id: number,
    fn: () => Promise<{ ok: boolean; reason?: string }>,
    success: string,
    undoId?: number,
    undoFrom?: DefinitionStatus,
  ) => {
    if (expired) return proPrompt()
    setBusyId(id)
    startTransition(async () => {
      let res: { ok: boolean; reason?: string }
      try {
        res = await fn()
      } catch {
        // Backstop for a stale context: never let a refusal reach the error
        // boundary. A genuine fault still reads as one.
        setBusyId(null)
        return expired ? proPrompt() : toast('error', t('admin.automations.toast.failed'))
      }
      setBusyId(null)
      if (!res.ok) return toast('error', t('admin.automations.toast.failed'))
      if (undoId !== undefined && (undoFrom === 'active' || undoFrom === 'paused')) {
        toast('success', t('admin.automations.toast.undo', { message: success }), 5000, () => {
          startTransition(async () => {
            await setAutomationStatus(undoId, undoFrom)
            router.refresh()
          })
        })
      } else {
        toast('success', success)
      }
      router.refresh()
    })
  }

  async function openLog(card: AutomationCardData) {
    // The run log is execution history, which is part of the paid capability.
    if (expired) return proPrompt()
    let res: Awaited<ReturnType<typeof listActivityForAutomationAction>>
    try {
      res = await listActivityForAutomationAction(card.id)
    } catch {
      return toast('error', t('admin.automations.toast.logFailed'))
    }
    if (res.ok === false) return toast('error', t('admin.automations.toast.logFailed'))
    setLog({ name: card.name, rows: res.rows })
  }

  return (
    /*
     * The panel trails the library, so in RTL it lands on the left exactly as
     * drawn. Below the two-pane threshold the panes stack — what is running
     * first, then what can be installed.
     */
    /*
     * The workspace lives INSIDE the settings shell — the nav stays on screen,
     * so this is the settings content column, not the window. `-me-8` is the
     * one exception: it cancels `main`'s padding on the panel's side only, so
     * the hairline still meets the window edge as drawn. The nav side keeps its
     * gutter, which is what holds the two apart.
     *
     * TWO PANES IS A DEVICE DECISION, so it is a MEDIA query. Whether the
     * Copilot is open changes how much room the library has; it does not change
     * whether a control centre belongs beside it. On desktop the panes never
     * stack — only the library's grid reflows, which is the container's
     * business (see AutomationTemplatesSection).
     */
    <div className='@container/page flex min-h-full flex-1 flex-col-reverse bg-bg desktop:-me-8 desktop:flex-row' {...region}>
      <AutomationTemplatesSection
        views={templates}
        query={query}
        onQueryChange={setQuery}
        onCreate={() => setSheet(BLANK)}
      />

      <AutomationControlCenter
        automations={automations}
        visible={visible}
        handled={DASHBOARD_DEMO.handled}
        waiting={DASHBOARD_DEMO.waiting}
        now={now}
        busyId={busyId}
        observationMode={observationMode}
        identityProblem={identityProblem}
        onCreate={() => setSheet(BLANK)}
        onEdit={(a) => setSheet(drafts[a.id] ?? BLANK)}
        onToggle={(a) =>
          run(
            a.id,
            () => setAutomationStatus(a.id, a.status === 'active' ? 'paused' : 'active'),
            a.status === 'active' ? t('admin.automations.toast.paused') : t('admin.automations.toast.activated'),
            a.id,
            a.status,
          )
        }
        onDuplicate={(a) => run(a.id, () => duplicateAutomation(a.id), t('admin.automations.toast.duplicated'))}
        onDelete={(a) => setConfirmDelete(a)}
        onActivity={(a) => openLog(a)}
      />

      {sheet && (
        <AutomationSheet
          draft={sheet}
          previewName={previewName}
          requirementContext={requirementContext}
          connections={connections}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null)
            router.refresh()
          }}
        />
      )}

      {log && <ActivityLogModal name={log.name} rows={log.rows} onClose={() => setLog(null)} />}

      <ConfirmPop
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete
          setConfirmDelete(null)
          if (target) run(target.id, () => setAutomationStatus(target.id, 'deleted'), t('admin.automations.toast.deleted'))
        }}
        msg={t('admin.automations.deleteConfirm', { name: confirmDelete?.name ?? '' })}
        confirmLbl={t('admin.automations.deleteLbl')}
        destructive
        translated
      />
    </div>
  )
}
