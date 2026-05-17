'use client'

import { useState } from 'react'
import { getIssuerCompletenessAction, getIssuerAction } from '@/actions/billing/issuer'
import type { IssuerData } from '@/lib/billing/issuer/fields'

/**
 * Orchestrates the four-state issue flow:
 *   - idle             — nothing showing
 *   - confirm          — issue ConfirmPop is open
 *   - identity         — incomplete + admin: IssuerIdentityModal is open
 *   - setup_required   — incomplete + non-admin: read-only modal
 *
 * Per Decision 1 of the locked UX rules: the issuer completeness check
 * fires BEFORE the ConfirmPop. The user is never interrupted after they
 * already committed.
 *
 * Per Decision 2: non-admins never see a writable form for issuer
 * fields — they get the setup-required state instead.
 *
 * Per the no-silent-actions rule: this hook only manages STATE. It does
 * not issue invoices, save profiles, or navigate. Those side effects
 * are the parent's job — the hook just tells it which modal to show.
 */

export type IssueFlowStage =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'identity'; initialValues: Partial<IssuerData> }
  | { kind: 'setup_required' }

export function useIssueFlow() {
  const [stage, setStage] = useState<IssueFlowStage>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)

  /**
   * Called by the issue button. Runs the issuer-completeness check
   * and routes to the appropriate next stage. Three outcomes:
   *
   *   - issuer complete            → stage becomes 'confirm'
   *   - incomplete + admin can edit → fetches values, stage becomes 'identity'
   *   - incomplete + non-admin      → stage becomes 'setup_required'
   *
   * On any error during pre-flight: stage stays 'idle' (silent bail).
   * The user can retry. A noisy toast for transient infra blips would
   * scare them mid-flow.
   */
  async function startIssueFlow(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const check = await getIssuerCompletenessAction()

      if ('error' in check) return // silent bail

      if ('missing' in check) {
        if (check.canEdit) {
          const data = await getIssuerAction()
          if ('error' in data) return
          setStage({ kind: 'identity', initialValues: data.issuer })
        } else {
          setStage({ kind: 'setup_required' })
        }
        return
      }

      // Issuer is complete — proceed to the existing confirm flow.
      setStage({ kind: 'confirm' })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Called by IssuerIdentityModal after its profile save succeeds.
   * The user explicitly chose "שמור והמשך" — proceed straight to the
   * final confirm dialog. From here it's the same path as the
   * complete case above.
   */
  function onIdentitySaved(): void {
    setStage({ kind: 'confirm' })
  }

  /** All cancel/close paths return to idle. */
  function close(): void {
    setStage({ kind: 'idle' })
  }

  return {
    stage,
    busy,
    startIssueFlow,
    onIdentitySaved,
    close,
  }
}
