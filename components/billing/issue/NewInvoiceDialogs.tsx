'use client'

import ConfirmPop from '@/lib/modals/ConfirmPop'
import ModalPop from '@/lib/modals/ModalPop'
import ClientFormPop from '@/components/clients/ClientFormPop'
import IssuerIdentityModal from '@/components/billing/issuer/IssuerIdentityModal'
import IssuerSetupRequiredModal from '@/components/billing/issuer/IssuerSetupRequiredModal'
import type { IssueFlowStage } from '@/hooks/useIssueFlow'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The new-invoice editor's dialogs: the issue confirmation, the new-lead form,
 * and the issuer identity / setup-required steps of the issue flow. State and
 * actions stay with the editor and `useIssueFlow`.
 */
export default function NewInvoiceDialogs({
  stage,
  busy,
  newLeadOpen,
  onCloseIssueFlow,
  onConfirmIssue,
  onIdentitySaved,
  onCloseNewLead,
  onLeadCreated,
}: {
  stage: IssueFlowStage
  busy: boolean
  newLeadOpen: boolean
  onCloseIssueFlow: () => void
  onConfirmIssue: () => Promise<void>
  onIdentitySaved: () => void
  onCloseNewLead: () => void
  onLeadCreated: (newLeadId: number) => void
}) {
  const t = useT()
  return (
    <>
      <ConfirmPop
        open={stage.kind === 'confirm'}
        onClose={() => (busy ? null : onCloseIssueFlow())}
        onConfirm={onConfirmIssue}
        confirmLbl={t('billing.editor.bar.issue')}
        msg={t('billing.editor.issueConfirm')}
        translated
      />

      <ModalPop open={newLeadOpen} pos='middle' onClose={onCloseNewLead} label={t('billing.editor.newLead')} translated>
        <ClientFormPop onCreated={onLeadCreated} onClose={onCloseNewLead} />
      </ModalPop>

      <IssuerIdentityModal
        open={stage.kind === 'identity'}
        initialValues={stage.kind === 'identity' ? stage.initialValues : {}}
        onSavedAndContinue={onIdentitySaved}
        onCancel={onCloseIssueFlow}
      />
      <IssuerSetupRequiredModal
        open={stage.kind === 'setup_required'}
        onClose={onCloseIssueFlow}
      />
    </>
  )
}
