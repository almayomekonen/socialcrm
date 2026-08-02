'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import OnboardingActionCard from '@/components/clients/OnboardingActionCard'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { Seperator } from '@/lib/Seperator'
import { toast } from '@/lib/toast'
import { AUTOMATION_RECIPES } from '@/lib/automations/recipes'
import { IDENTITY_PROBLEM_COPY, type IdentityProblem } from '@/lib/automations/identity'
import { duplicateAutomation, setAutomationStatus } from '@/actions/automations/manage'
import { listActivityForAutomationAction } from '@/actions/automations/activity'
import AutomationCard, { type AutomationCardData } from './AutomationCard'
import AutomationSheet, { type SheetDraft } from './AutomationSheet'
import ActivityLogModal, { type ActivityRow } from './ActivityLogModal'

/**
 * The אוטומציות surface (spec §4/§8). Thin orchestrator: it owns which sheet
 * or modal is open and nothing else — the cards, the sheet, the gallery and
 * the log each own their own concern.
 *
 * The recipe gallery IS the empty state: the first screen a user sees is the
 * same one they will use forever, so there is nothing to learn twice.
 */

const DRAFT_FROM_RECIPE = (key: string): SheetDraft | null => {
  const r = AUTOMATION_RECIPES.find((x) => x.key === key)
  if (!r) return null
  return {
    name: r.name,
    recipeKey: r.key,
    trigger: r.trigger.type,
    sourceFilter: r.trigger.sourceFilter,
    targetStatus: r.trigger.targetStatus,
    subject: r.subject,
    body: r.body,
    timing: r.timing,
  }
}

const BLANK: SheetDraft = {
  name: '',
  recipeKey: null,
  trigger: 'lead_created',
  sourceFilter: null,
  targetStatus: null,
  subject: '',
  body: '',
  timing: { kind: 'preset', preset: 'immediate' },
}

type Props = {
  automations: AutomationCardData[]
  drafts: Record<number, SheetDraft>
  previewName: string | null
  identityProblem: IdentityProblem | null
  observationMode: boolean
}

export default function AutomationsSettings({ automations, drafts, previewName, identityProblem, observationMode }: Props) {
  const router = useRouter()
  const [sheet, setSheet] = useState<SheetDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AutomationCardData | null>(null)
  const [log, setLog] = useState<{ name: string; rows: ActivityRow[] } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  const run = (id: number, fn: () => Promise<{ ok: boolean; reason?: string }>, success: string) => {
    setBusyId(id)
    startTransition(async () => {
      const res = await fn()
      setBusyId(null)
      if (!res.ok) return toast('error', 'הפעולה נכשלה. נסו שוב.')
      toast('success', success)
      router.refresh()
    })
  }

  async function openLog(card: AutomationCardData) {
    const res = await listActivityForAutomationAction(card.id)
    if (res.ok === false) return toast('error', 'לא ניתן לטעון את יומן הפעילות')
    setLog({ name: card.name, rows: res.rows })
  }

  return (
    <div className='max-w-3xl'>
      <h1 className='title'>אוטומציות</h1>
      <p className='text-sm text-gray-500 mt-1 mb-4'>
        אוטומציה שולחת אימייל לליד ברגע הנכון — גם כשאתם עסוקים.
      </p>

      {observationMode && (
        <p className='text-sm text-gray-600 border rounded-md bg-gray-50 p-3 mb-4'>
          מצב תצפית — המערכת מתעדת מה הייתה נשלחת, בלי לשלוח בפועל.
        </p>
      )}
      {identityProblem && (
        <p className='text-sm text-red-600 border border-red-200 rounded-md bg-red-50 p-3 mb-4' role='alert'>
          {IDENTITY_PROBLEM_COPY[identityProblem]}
        </p>
      )}

      {automations.length > 0 && (
        <>
          <div className='grid gap-3'>
            {automations.map((a) => (
              <AutomationCard
                key={a.id}
                data={a}
                busy={busyId === a.id}
                onEdit={() => setSheet(drafts[a.id] ?? BLANK)}
                onToggle={() =>
                  run(
                    a.id,
                    () => setAutomationStatus(a.id, a.status === 'active' ? 'paused' : 'active'),
                    a.status === 'active' ? 'האוטומציה הושהתה' : 'האוטומציה פעילה',
                  )
                }
                onDuplicate={() => run(a.id, () => duplicateAutomation(a.id), 'נוצר עותק כטיוטה')}
                onDelete={() => setConfirmDelete(a)}
                onActivity={() => openLog(a)}
              />
            ))}
          </div>
          <Seperator className='my-6' />
        </>
      )}

      <section className='grid gap-3'>
        <h2 className='text-sm font-semibold text-gray-800'>
          {automations.length ? 'הוספת אוטומציה' : 'אין עדיין אוטומציות — אפשר להתחיל מאחת מאלה'}
        </h2>
        {AUTOMATION_RECIPES.map((r) => (
          <OnboardingActionCard
            key={r.key}
            icon='envelope'
            tileClass='bg-primary'
            title={r.name}
            description={r.description}
            onClick={() => setSheet(DRAFT_FROM_RECIPE(r.key) ?? BLANK)}
          />
        ))}
        <OnboardingActionCard
          icon='plus'
          tileClass='bg-gray-400'
          title='אוטומציה חדשה מאפס'
          description='בניית אוטומציה משלכם, שלב אחר שלב'
          onClick={() => setSheet(BLANK)}
        />
      </section>

      {sheet && (
        <AutomationSheet
          draft={sheet}
          previewName={previewName}
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
