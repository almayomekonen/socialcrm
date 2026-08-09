'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
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
  const run = (
    id: number,
    fn: () => Promise<{ ok: boolean; reason?: string }>,
    success: string,
    undoId?: number,
    undoFrom?: DefinitionStatus,
  ) => {
    setBusyId(id)
    startTransition(async () => {
      const res = await fn()
      setBusyId(null)
      if (!res.ok) return toast('error', 'הפעולה נכשלה. נסו שוב.')
      if (undoId !== undefined && (undoFrom === 'active' || undoFrom === 'paused')) {
        toast('success', `${success} · ביטול`, 5000, () => {
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
    const res = await listActivityForAutomationAction(card.id)
    if (res.ok === false) return toast('error', 'לא ניתן לטעון את יומן הפעילות')
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
    <div className='@container/page flex min-h-full flex-1 flex-col-reverse bg-bg desktop:-me-8 desktop:flex-row'>
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
            a.status === 'active' ? 'האוטומציה הושהתה' : 'האוטומציה פעילה',
            a.id,
            a.status,
          )
        }
        onDuplicate={(a) => run(a.id, () => duplicateAutomation(a.id), 'נוצר עותק כטיוטה')}
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
          if (target) run(target.id, () => setAutomationStatus(target.id, 'deleted'), 'האוטומציה נמחקה')
        }}
        msg={`האוטומציה "${confirmDelete?.name ?? ''}" תימחק ותפסיק לפעול. ההיסטוריה תישמר.`}
        confirmLbl='מחק'
        destructive
      />
    </div>
  )
}
