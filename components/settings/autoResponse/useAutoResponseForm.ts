'use client'

import { useState, useTransition } from 'react'
import { updateAutoResponseSettings } from '@/actions/autoResponse/updateSettings'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard'
import { SAVE_ERROR_KEY, saveErrorCode, toDraft, withMethod, type AutoResponseFormProps, type Draft, type SaveErrorCode } from './autoResponseDraft'
import type { ResponseMethod } from '@/lib/inbox/autoresponse/responseMethod'
import { fromAgentProfileDraft, toAgentProfileDraft, type AgentProfileDraft } from './AutoResponseAgentProfile'

/**
 * The מענה אוטומטי form's state: the draft against its saved baseline, the
 * agent profile likewise, and the one save.
 *
 * Moved out of `AutoResponseSettingsForm.tsx` when the sticky save bar and the
 * unload guard landed (architecture-rules §3: the component renders, the hook
 * decides). The response method is part of the draft and goes out with the
 * same save.
 */
export function useAutoResponseForm(initial: AutoResponseFormProps) {
  const t = useT()
  const [baseline, setBaseline] = useState<Draft>(() => toDraft(initial))
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [errorCode, setError] = useState<SaveErrorCode | null>(null)
  const [pending, startTransition] = useTransition()
  const showProfile = initial.agentProfile !== undefined
  const [profileBaseline, setProfileBaseline] = useState<AgentProfileDraft>(() => toAgentProfileDraft(initial.agentProfile ?? null))
  const [profile, setProfileState] = useState<AgentProfileDraft>(profileBaseline)
  const [unsupported, setUnsupported] = useState<string[]>([])
  const [savedDescription, setSavedDescription] = useState(initial.guidance ?? '')

  const profileDirty = showProfile && JSON.stringify(profile) !== JSON.stringify(profileBaseline)
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== baseline[k]) || profileDirty
  const error = errorCode ? t(SAVE_ERROR_KEY[errorCode]) : null

  useUnsavedChangesGuard(dirty)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setError(null)
  }

  function setMethod(method: ResponseMethod) {
    setDraft((d) => withMethod(d, method))
    setError(null)
  }

  function setProfile(next: AgentProfileDraft) {
    setProfileState(next)
    setError(null)
  }

  function cancel() {
    setDraft(baseline)
    setProfileState(profileBaseline)
    setError(null)
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await updateAutoResponseSettings({
        masterEnabled: draft.master,
        channelEnabled: draft.channel,
        dailyCap: Number(draft.dailyCap) || 0,
        guidance: draft.guidance.trim() || null,
        agentInstructions: draft.agentInstructions.trim() || null,
        businessName: draft.businessName.trim() || null,
        replyMode: draft.replyMode,
        fixedBody: draft.fixedBody.trim() || null,
        delaySeconds: Number(draft.delaySeconds) || 0,
        // One action, one transaction: the method's columns are written with
        // everything else, and only if the stored method is still the one shown.
        method: draft.method,
        methodFrom: baseline.method,
        ...(showProfile ? { agentProfile: fromAgentProfileDraft(profile) } : {}),
      })
      if (result.ok === false) {
        // `profile_derivation_failed` is the recoverable one: everything the
        // owner typed IS saved and the agent still works from their words —
        // only the structured view is missing, and saving again retries it.
        setError(saveErrorCode(result.reason))
        if (result.reason === 'profile_derivation_failed') {
          setBaseline(draft)
          setSavedDescription(draft.guidance)
        }
        return
      }
      setBaseline(draft)
      setProfileBaseline(profile)
      setSavedDescription(draft.guidance)
      setUnsupported(result.unsupportedRequests)
      // The bar leaves with the changes, so the confirmation goes where the
      // product confirms every save (ux-guidelines §8).
      toast('success', t('admin.autoResponse.save.saved'))
    })
  }

  return {
    draft,
    baseline,
    set,
    setMethod,
    profile,
    profileBaseline,
    setProfile,
    showProfile,
    dirty,
    errorCode,
    error,
    pending,
    unsupported,
    savedDescription,
    cancel,
    save,
  }
}
