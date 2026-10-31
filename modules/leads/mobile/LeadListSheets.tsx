'use client'

import ConfirmSheet from '@/components/mobile/ConfirmSheet'
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
  const close = () => setAction(null)
  const deleteMsg =
    count === 1
      ? `האם למחוק את "${actionLead?.name ?? 'הליד'}"?\nלא ניתן לשחזר את הליד לאחר המחיקה.`
      : `האם למחוק ${count} לידים?\nלא ניתן לשחזר את הלידים לאחר המחיקה.`

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
                followUp: followUpBadge(nextFollowUpAt, nowMs, dayStartMs),
              }),
            )
          }}
        />
      )}

      <ConfirmSheet
        open={action?.type === 'confirm-delete'}
        destructive
        title={count === 1 ? 'מחיקת ליד' : 'מחיקת לידים'}
        msg={deleteMsg}
        confirmLbl={count === 1 ? 'מחק ליד' : 'מחק לידים'}
        cancelLbl='ביטול'
        onClose={close}
        onConfirm={onDelete}
      />
    </>
  )
}
