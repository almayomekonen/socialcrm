'use client'

import BottomSheet from '@/components/mobile/BottomSheet'
import { useT } from '@/lib/i18n/I18nProvider'
import type { LeadListCard } from './leadSelection'

/**
 * Per-lead actions available from list selection. Status / follow-up / open
 * conversation are single-lead contracts — this sheet only opens when exactly
 * one id is selected. Delete is offered from the sticky bar (and here) because
 * `deleteManyLeads` already exists.
 */
export default function LeadListActionsSheet({
  open,
  lead,
  onClose,
  onStatus,
  onFollowUp,
  onOpenConversation,
  onDelete,
}: {
  open: boolean
  lead: LeadListCard | null
  onClose: () => void
  onStatus: () => void
  onFollowUp: () => void
  onOpenConversation: () => void
  onDelete: () => void
}) {
  const t = useT()
  const canChat = Boolean(lead?.phone || lead?.waPhone)

  return (
    <BottomSheet open={open && lead != null} onClose={onClose} title={t('leads.mobile.sheet.leadActions')} titleId='lead-list-actions' translated>
      <div className='flex flex-col gap-2'>
        <SheetBtn label={t('leads.mobile.sheet.changeStatus')} onClick={onStatus} />
        <SheetBtn label={t('leads.mobile.sheet.addFollowUp')} onClick={onFollowUp} />
        {canChat && <SheetBtn label={t('leads.mobile.sheet.openChat')} onClick={onOpenConversation} />}
        <SheetBtn label={t('leads.mobile.sheet.deleteLead')} danger onClick={onDelete} />
      </div>
    </BottomSheet>
  )
}

function SheetBtn({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`press flex min-h-11 w-full items-center justify-center rounded-md font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        danger
          ? 'border border-red-200 bg-white text-red-700 hover:bg-red-50'
          : 'border border-gray-200 bg-white text-ink hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )
}
