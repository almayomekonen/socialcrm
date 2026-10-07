'use client'

/**
 * The questionnaire draft being edited: local state, autosave, and the rules
 * that keep it from ever losing or overwriting work.
 *
 *   · AUTOSAVE, SERIAL. Edits are saved a moment after the owner stops typing.
 *     One save at a time: an edit made while a save is in flight is saved right
 *     after it, with the version that save returned.
 *   · NEVER OVERWRITE. Every save names the version it was based on (PR1
 *     optimistic concurrency). If another tab saved, published or discarded in
 *     between, autosave stops and the editor says so; nothing is retried
 *     blindly.
 *   · NEVER LOSE. Local state stays authoritative while editing; a save only
 *     hands back the ids it assigned to new questions and options (adoptIds).
 *     Leaving the page with unsaved changes asks first.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { openQuestionnaireDraft, saveQuestionnaireDraft } from '@/actions/questionnaire/builderDraft'
import { adoptIds } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { DraftState } from '@/lib/inbox/autoresponse/questionnaire/builder/draftState'

const AUTOSAVE_MS = 800

export type DraftPhase = 'opening' | 'ready' | 'conflict' | 'failed'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
/** Why autosave stopped: someone else changed the draft, or it is gone. */
export type ConflictKind = 'changed_elsewhere' | 'published_elsewhere' | 'gone'

type Meta = { draftId: number; version: number; baseRevision: number | null }

export function useQuestionnaireDraft(initial: DraftState | null) {
  const [phase, setPhase] = useState<DraftPhase>(initial ? 'ready' : 'opening')
  const [model, setModel] = useState<BuilderQuestionnaire | null>(initial?.questionnaire ?? null)
  const [meta, setMeta] = useState<Meta | null>(initial ? toMeta(initial) : null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [conflict, setConflict] = useState<ConflictKind | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const modelRef = useRef(model)
  const metaRef = useRef(meta)
  const dirty = useRef(false)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopped = useRef(false)

  const adopt = useCallback((state: DraftState) => {
    const m = toMeta(state)
    modelRef.current = state.questionnaire
    metaRef.current = m
    dirty.current = false
    stopped.current = false
    setModel(state.questionnaire)
    setMeta(m)
    setPhase('ready')
    setConflict(null)
    setSaveStatus('idle')
  }, [])

  // No draft yet: open one (PR1 reuses the existing draft or copies the live revision).
  useEffect(() => {
    if (initial) return
    let cancelled = false
    void openQuestionnaireDraft().then((res) => {
      if (cancelled) return
      if (res.ok === true) adopt(res)
      else {
        setFailure(res.reason)
        setPhase('failed')
      }
    })
    return () => {
      cancelled = true
    }
  }, [initial, adopt])

  const stop = (kind: ConflictKind) => {
    stopped.current = true
    if (timer.current) clearTimeout(timer.current)
    setConflict(kind)
    setPhase('conflict')
  }

  const saveOnce = useCallback(async (): Promise<boolean> => {
    const current = metaRef.current
    const snapshot = modelRef.current
    if (stopped.current || !current || !snapshot) return false
    dirty.current = false
    setSaveStatus('saving')
    const res = await saveQuestionnaireDraft({
      draftId: current.draftId,
      expectedVersion: current.version,
      questionnaire: snapshot,
    })
    if (res.ok === true) {
      metaRef.current = { ...current, version: res.draftVersion }
      setMeta(metaRef.current)
      if (Object.keys(res.assigned).length) {
        const next = adoptIds(modelRef.current ?? snapshot, res.assigned)
        modelRef.current = next
        setModel(next)
      }
      if (!dirty.current) setSaveStatus('saved')
      return true
    }
    if (res.reason === 'version_conflict') stop('changed_elsewhere')
    else if (res.reason === 'draft_published') stop('published_elsewhere')
    else if (res.reason === 'not_found') stop('gone')
    else if (res.reason === 'invalid_draft' && res.issues.some((i) => i.code === 'unknown_id' || i.code === 'duplicate_id'))
      stop('changed_elsewhere')
    else {
      // Kept locally and still dirty, so the next edit (or flush) tries again.
      dirty.current = true
      setSaveStatus('error')
    }
    return false
  }, [])

  /** Save everything that is not saved yet. Resolves false when that is impossible. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    for (let i = 0; i < 5; i++) {
      if (inFlight.current) {
        await inFlight.current
        continue
      }
      if (!dirty.current) return !stopped.current
      inFlight.current = saveOnce()
      const ok = await inFlight.current
      inFlight.current = null
      if (!ok) return false
    }
    return !dirty.current
  }, [saveOnce])

  const edit = useCallback(
    (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => {
      if (stopped.current || !modelRef.current) return
      const next = change(modelRef.current)
      if (next === modelRef.current) return
      modelRef.current = next
      dirty.current = true
      setModel(next)
      setSaveStatus((s) => (s === 'error' ? s : 'idle'))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS)
    },
    [flush],
  )

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (!dirty.current && !inFlight.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const getMeta = useCallback(() => metaRef.current, [])

  return { phase, model, meta, getMeta, saveStatus, conflict, failure, edit, flush, adopt }
}

function toMeta(state: DraftState): Meta {
  return { draftId: state.draftId, version: state.draftVersion, baseRevision: state.baseRevision }
}
