'use client'

/**
 * Publishing the draft, and starting a draft from an older version.
 *
 * PUBLISH: save what is pending → the server's own publish check (PR1
 * `checkDraft`, the check publish itself enforces) → the owner confirms →
 * `publishDraft` makes the next immutable revision → a fresh draft is opened
 * from it, so editing continues on top of what is now live. Publishing never
 * turns the questionnaire on or off; it changes which version new
 * conversations get.
 *
 * RESTORE: the current draft is replaced (after the owner confirms) by a copy
 * of the chosen version. Publishing that copy makes a NEW version.
 */
import { useState } from 'react'
import { checkQuestionnaireDraft, discardQuestionnaireDraft, openQuestionnaireDraft } from '@/actions/questionnaire/builderDraft'
import { publishQuestionnaireDraft } from '@/actions/questionnaire/builderPublish'
import type { BuilderIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/checks'
import type { DraftState } from '@/lib/inbox/autoresponse/questionnaire/builder/draftState'
import { PUBLISH_COPY } from '@/components/settings/questionnaire/builderCopy'
import { toast } from '@/lib/toast'

type Draft = {
  /** Read at call time: a save during this flow moves the version. */
  getMeta: () => { draftId: number; version: number; baseRevision: number | null } | null
  flush: () => Promise<boolean>
  adopt: (state: DraftState) => void
}

export type ReleaseState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'confirm'; nextRevision: number }
  | { kind: 'publishing' }
  | { kind: 'blocked'; message: string; issues: BuilderIssue[] }

export function useQuestionnaireRelease(draft: Draft, initialLive: number | null) {
  const [state, setState] = useState<ReleaseState>({ kind: 'idle' })
  const [liveRevision, setLiveRevision] = useState<number | null>(initialLive)

  const block = (reason: string, issues: BuilderIssue[] = []) =>
    setState({ kind: 'blocked', message: PUBLISH_COPY[reason] ?? 'הפרסום לא הצליח. נסו שוב.', issues })

  async function requestPublish() {
    setState({ kind: 'checking' })
    const meta = (await draft.flush()) ? draft.getMeta() : null
    if (!meta) return block('version_conflict')
    const check = await checkQuestionnaireDraft({ draftId: meta.draftId })
    if (check.ok === false) return block(check.reason)
    if (!check.ready) return block('not_ready', check.issues)
    setState({ kind: 'confirm', nextRevision: (meta.baseRevision ?? 0) + 1 })
  }

  async function confirmPublish() {
    const meta = draft.getMeta()
    if (!meta) return
    setState({ kind: 'publishing' })
    const res = await publishQuestionnaireDraft({ draftId: meta.draftId, expectedVersion: meta.version })
    if (res.ok === false) return block(res.reason, 'issues' in res ? res.issues : [])
    setLiveRevision(res.revision)
    toast('success', `גרסה ${res.revision} פורסמה`)
    const reopened = await openQuestionnaireDraft()
    if (reopened.ok === true) draft.adopt(reopened)
    setState({ kind: 'idle' })
  }

  /** Replace the draft with a copy of `revision`. Resolves false when it could not. */
  async function restore(revision: number): Promise<boolean> {
    await draft.flush()
    const current = draft.getMeta()
    if (!current) return false
    const gone = await discardQuestionnaireDraft({ draftId: current.draftId, expectedVersion: current.version })
    if (gone.ok === false && gone.reason !== 'not_found') {
      block('version_conflict')
      return false
    }
    const opened = await openQuestionnaireDraft({ fromRevision: revision })
    if (opened.ok === false) {
      block(opened.reason)
      return false
    }
    draft.adopt(opened)
    toast('success', `נוצרה טיוטה מגרסה ${revision}`)
    return true
  }

  return { state, liveRevision, requestPublish, confirmPublish, restore, dismiss: () => setState({ kind: 'idle' }) }
}
