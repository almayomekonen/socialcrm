'use client'

import ConfirmSheet from '@/components/mobile/ConfirmSheet'
import { useT } from '@/lib/i18n/I18nProvider'
import type { ActionContext } from '@/components/mobile/selectionState'
import LeadStatusSheet from './LeadStatusSheet'
import LeadFollowUpSheet from './LeadFollowUpSheet'
import LeadListActionsSheet from './LeadListActionsSheet'
import { followUpBadge } from './followUpBadge'
import { patchLead, type LeadListCard } from './leadSelection'

/**
 * The phone list's selection sheets — per-lead actions, status, follow-up and
 * the delete confirmation (extracted from `LeadListMobileClient`, no behaviour
 * change). One sheet at a time: which one is open is the selection's `action`.
 */
export default function LeadListSheets({
  action,
  actionLeadId,
  actionLead,
  count,
  nowMs,
  dayStartMs,
  setAction,
  setItems,
  onOpenConversation,
  onDelete,
}: {
  action: ActionContext
  actionLeadId: number | null
  actionLead: LeadListCard | null
  count: number
  nowMs: number
  dayStartMs: number
  setAction: (next: ActionContext) => void
  setItems: (update: (prev: LeadListCard[]) => LeadListCard[]) => void
  onOpenConversation: () => void
  onDelete: () => void
}) {
  const t = useT()
  const close = () => setAction(null)
  const deleteMsg =
    count === 1
      ? t('leads.mobile.confirm.msgOne', { name: actionLead?.name ?? t('leads.mobile.confirm.fallbackName') })
      : t('leads.mobile.confirm.msgMany', { count: String(count) })

  return (
    <>
      <LeadListActionsSheet
        open={action?.type === 'item-actions'}
        lead={actionLead}
        onClose={close}
        onStatus={() => {
          if (actionLeadId == null) return
          setAction({ type: 'status', id: actionLeadId })
        }}
        onFollowUp={() => {
          if (actionLeadId == null) return
          setAction({ type: 'followup', id: actionLeadId })
        }}
        onOpenConversation={onOpenConversation}
        onDelete={() => setAction({ type: 'confirm-delete' })}
      />

      {actionLeadId != null && (
        <LeadStatusSheet
          open={action?.type === 'status'}
          onClose={close}
          leadId={actionLeadId}
          current={actionLead?.status ?? null}
          refresh={false}
          onSaved={(status) => {
            setItems((prev) => patchLead(prev, actionLeadId, { status }))
          }}
        />
      )}

      {actionLeadId != null && (
        <LeadFollowUpSheet
          open={action?.type === 'followup'}
          onClose={close}
          leadId={actionLeadId}
          current={actionLead?.nextFollowUpAt ?? null}
          refresh={false}
          onSaved={(nextFollowUpAt) => {
            setItems((prev) =>
              patchLead(prev, actionLeadId, {
                nextFollowUpAt,
                followUp: followUpBadge(nextFollowUpAt, nowMs, dayStartMs, t.locale),
              }),
            )
          }}
        />
      )}

      <ConfirmSheet
        open={action?.type === 'confirm-delete'}
        destructive
        title={count === 1 ? t('leads.mobile.confirm.titleOne') : t('leads.mobile.confirm.titleMany')}
        msg={deleteMsg}
        confirmLbl={count === 1 ? t('leads.mobile.confirm.deleteOne') : t('leads.mobile.confirm.deleteMany')}
        cancelLbl={t('common.dialog.cancel')}
        translated
        onClose={close}
        onConfirm={onDelete}
      />
    </>
  )
}
