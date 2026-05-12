'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import type { CopilotActionId, PredefinedCopilotActionId } from '@/lib/copilot/copilotResponse'
import type { CopilotSuggestedAction } from '@/lib/copilot/copilotContext'
import { LENS_IDS, type LensId } from '@/lib/ai/prompts/leadAskQuestion'
import type { IconNames } from '@/lib/Icon'
import { useUser } from '@/lib/hooksNEvents'
import { extractFile, type ExtractedAttachment } from '@/lib/copilot/clientExtract'
import {
  COPILOT_MAX_ATTACHMENTS,
  COPILOT_MAX_FILE_BYTES,
  COPILOT_MAX_QUESTION_CHARS,
  type CopilotAttachmentPayload,
} from '@/lib/copilot/attachments'
import { uploadCopilotAttachments } from '@/lib/copilot/uploadAttachments'
import {
  COPILOT_MODES,
  DEFAULT_COPILOT_MODE_ID,
  getCopilotMode,
  type CopilotMode,
  type CopilotModeId,
} from '@/lib/ai/copilotModes'
import { readPersistedMode, writePersistedMode } from '@/lib/copilot/copilotModeState'

type Props = {
  actions: CopilotSuggestedAction[]
  onAction: (id: PredefinedCopilotActionId) => void
  onSubmit: (text: string, lenses: LensId[], attachments: CopilotAttachmentPayload[], mode: CopilotModeId) => void
  loadingId: CopilotActionId | null
  placeholder: string
  leadId?: number | null
  disabled?: boolean
}

const MAX_TEXTAREA_HEIGHT = 160

const UPLOAD_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx'

type AttachmentItem = {
  id: string
  file: File
  status: 'reading' | 'ready' | 'partial' | 'unreadable' | 'uploading' | 'error'
  extracted?: ExtractedAttachment
}

const LENS_LABEL: Record<LensId, string> = {
  conversations: 'שיחות אחרונות',
  tasks: 'משימות',
  notes: 'הערות',
  files: 'קבצים',
}

const LENS_ICON: Record<LensId, IconNames> = {
  conversations: 'comment',
  tasks: 'list-check',
  notes: 'note-sticky',
  files: 'paperclip',
}

export default function CopilotComposer({
  actions,
  onAction,
  onSubmit,
  loadingId,
  placeholder,
  leadId = null,
  disabled = false,
}: Props) {
  const user = useUser()
  const [value, setValue] = useState('')
  const [lenses, setLenses] = useState<LensId[]>([])
  const [attachedFiles, setAttachedFiles] = useState<AttachmentItem[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [preparingFiles, setPreparingFiles] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const [modeId, setModeId] = useState<CopilotModeId>(DEFAULT_COPILOT_MODE_ID)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Hydrate the persisted mode after mount to avoid SSR/client divergence.
  useEffect(() => {
    setModeId(readPersistedMode())
  }, [])

  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  // Outside-click + Escape closes whichever popover is open.
  useEffect(() => {
    if (!toolsOpen && !attachOpen && !modeOpen) return
    function onPointer(e: MouseEvent) {
      if (!composerRef.current?.contains(e.target as Node)) {
        setToolsOpen(false)
        setAttachOpen(false)
        setModeOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setToolsOpen(false)
        setAttachOpen(false)
        setModeOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [toolsOpen, attachOpen, modeOpen])

  function selectMode(id: CopilotModeId) {
    setModeId(id)
    writePersistedMode(id)
    setModeOpen(false)
  }

  function handleSelectAction(id: PredefinedCopilotActionId) {
    setToolsOpen(false)
    onAction(id)
  }

  function toggleLens(id: LensId) {
    setLenses((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function removeLens(id: LensId) {
    setLenses((prev) => prev.filter((x) => x !== id))
  }

  function triggerFilePicker() {
    setAttachOpen(false)
    fileInputRef.current?.click()
  }

  function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length === 0) return
    setFileError(null)

    const remainingSlots = Math.max(0, COPILOT_MAX_ATTACHMENTS - attachedFiles.length)
    const accepted = picked.filter((f) => f.size <= COPILOT_MAX_FILE_BYTES).slice(0, remainingSlots)
    if (picked.some((f) => f.size > COPILOT_MAX_FILE_BYTES)) setFileError('קובץ אחד גדול מדי לצירוף.')
    if (picked.filter((f) => f.size <= COPILOT_MAX_FILE_BYTES).length > accepted.length) {
      setFileError(`אפשר לצרף עד ${COPILOT_MAX_ATTACHMENTS} קבצים.`)
    }

    if (accepted.length > 0) {
      const items = accepted.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        status: 'reading' as const,
      }))
      setAttachedFiles((prev) => [...prev, ...items])
      for (const item of items) {
        void extractFile(item.file).then((extracted) => {
          setAttachedFiles((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? { ...current, extracted, status: extractionStatus(extracted) }
                : current,
            ),
          )
        })
      }
    }
    e.target.value = ''
  }

  function removeAttachedFile(id: string) {
    setAttachedFiles((prev) => prev.filter((item) => item.id !== id))
  }

  const trimmed = value.trim()
  const filesReading = attachedFiles.some((item) => item.status === 'reading')
  const sendReady = !disabled && trimmed.length > 0 && loadingId === null && !filesReading && !preparingFiles
  const toolsDisabled = disabled || actions.length === 0
  const attachDisabled = disabled || preparingFiles

  async function submit() {
    if (!sendReady) return
    const question = trimmed
    const selectedLenses = lenses
    const files = attachedFiles

    try {
      setFileError(null)
      setPreparingFiles(files.length > 0)

      let attachments: CopilotAttachmentPayload[] = []
      if (files.length > 0) {
        if (!leadId || !user?.id) {
          setFileError('אי אפשר לצרף קובץ בלי ליד פעיל.')
          return
        }
        const readyFiles = files.filter((item) => item.extracted)
        setAttachedFiles((prev) => prev.map((item) => ({ ...item, status: item.extracted ? 'uploading' : item.status })))
        attachments = await uploadCopilotAttachments({
          items: readyFiles.map((item) => ({ file: item.file, extracted: item.extracted! })),
          leadId,
          userId: user.id,
        })
      }

      onSubmit(question, selectedLenses, attachments, modeId)
      setValue('')
      setLenses([])
      setAttachedFiles([])
    } catch {
      setFileError('העלאת הקבצים נכשלה. נסה שוב.')
      setAttachedFiles((prev) => prev.map((item) => ({ ...item, status: 'error' })))
    } finally {
      setPreparingFiles(false)
    }
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div ref={composerRef} className='relative w-full'>
      <div
        className={[
          'block w-full rounded-[10px] bg-white border border-gray-100',
          'shadow-[0_4px_18px_-8px_rgba(15,23,42,0.12),0_1px_3px_rgba(15,23,42,0.04)]',
          'focus-within:shadow-[0_6px_22px_-8px_rgba(99,102,241,0.20),0_1px_3px_rgba(15,23,42,0.04)]',
          'focus-within:border-indigo-200 transition-all duration-200',
          'cursor-text',
        ].join(' ')}
        onClick={() => textareaRef.current?.focus()}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, COPILOT_MAX_QUESTION_CHARS))}
          onKeyDown={onTextareaKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label='שאל את העוזר'
          className={[
            'w-full resize-none bg-transparent border-0',
            'px-4 pt-3 pb-1 text-md font-medium leading-normal',
            'text-gray-900 placeholder:text-gray-700',
            'focus:outline-none focus:ring-0',
            'disabled:cursor-not-allowed',
          ].join(' ')}
          style={{ minHeight: 36 }}
        />

        {(lenses.length > 0 || attachedFiles.length > 0) && (
          <div className='flex flex-wrap items-center gap-1 px-3 pb-1'>
            {lenses.map((id) => (
              <LensChip key={`lens-${id}`} id={id} onRemove={() => removeLens(id)} />
            ))}
            {attachedFiles.map((item) => (
              <FileChip key={item.id} item={item} onRemove={() => removeAttachedFile(item.id)} />
            ))}
          </div>
        )}

        {fileError && <p className='px-3 pb-1 text-[11px] text-red-500'>{fileError}</p>}

        <div className='flex items-center gap-1 px-2 pb-2 pt-0.5'>
          <AttachButton
            open={attachOpen}
            disabled={attachDisabled}
            onToggle={() => {
              setAttachOpen((v) => !v)
              setToolsOpen(false)
            }}
          />

          <ToolsButton
            open={toolsOpen}
            disabled={toolsDisabled}
            onToggle={() => {
              setToolsOpen((v) => !v)
              setAttachOpen(false)
            }}
            loading={loadingId !== null}
          />

          <div className='ms-auto flex items-center gap-1.5'>
            <ModeButton
              open={modeOpen}
              disabled={disabled}
              mode={getCopilotMode(modeId)}
              onToggle={() => {
                setModeOpen((v) => !v)
                setAttachOpen(false)
                setToolsOpen(false)
              }}
            />
            <SendButton ready={sendReady} onClick={() => void submit()} loading={loadingId === 'ask-question' || preparingFiles} />
          </div>
        </div>
      </div>

      {toolsOpen && !toolsDisabled && (
        <ToolsPopover actions={actions} loadingId={loadingId} onSelect={handleSelectAction} />
      )}

      {attachOpen && !attachDisabled && (
        <AttachPopover
          selected={lenses}
          onToggle={toggleLens}
          onUpload={triggerFilePicker}
          onClose={() => setAttachOpen(false)}
        />
      )}

      {modeOpen && !disabled && <ModePopover activeId={modeId} onSelect={selectMode} />}

      <input
        ref={fileInputRef}
        type='file'
        multiple
        accept={UPLOAD_ACCEPT}
        onChange={onFilesPicked}
        className='sr-only'
        tabIndex={-1}
        aria-hidden='true'
      />
    </div>
  )
}

function AttachButton({ open, disabled, onToggle }: { open: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type='button'
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup='menu'
      aria-expanded={open}
      aria-label='הוסף הקשר מהליד'
      title='הוסף הקשר מהליד'
      className={[
        'shrink-0 inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        open ? 'bg-indigo-50' : 'hover:bg-gray-50',
      ].join(' ')}
    >
      <Icon
        name='plus'
        type='reg'
        className={`size-4 transition-colors ${open ? 'bg-indigo-500' : 'bg-gray-500'}`}
      />
    </button>
  )
}

function ToolsButton({
  open,
  disabled,
  onToggle,
  loading,
}: {
  open: boolean
  disabled: boolean
  onToggle: () => void
  loading: boolean
}) {
  return (
    <button
      type='button'
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup='menu'
      aria-expanded={open}
      aria-label='כלים'
      title='כלים'
      className={[
        'shrink-0 inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        open ? 'bg-indigo-50' : 'hover:bg-gray-50',
      ].join(' ')}
    >
      {loading ? (
        <span
          className='inline-block size-2.5 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin'
          aria-hidden='true'
        />
      ) : (
        <Icon
          name='sliders-simple'
          type='reg'
          className={`size-4 transition-colors ${open ? 'bg-indigo-500' : 'bg-gray-500'}`}
        />
      )}
    </button>
  )
}

function SendButton({ ready, loading, onClick }: { ready: boolean; loading: boolean; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={!ready}
      aria-label='שלח שאלה'
      title='שלח (Enter)'
      className={[
        'shrink-0 inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150',
        ready
          ? 'bg-gray-900 hover:bg-gray-800 cursor-pointer'
          : 'bg-gray-100 cursor-not-allowed',
      ].join(' ')}
    >
      {loading ? (
        <span
          className='inline-block size-3 rounded-full border-2 border-white/40 border-t-white animate-spin'
          aria-hidden='true'
        />
      ) : (
        <Icon
          name='arrow-up'
          type='reg'
          className={`size-3.5 transition-colors ${ready ? 'bg-white' : 'bg-gray-400'}`}
        />
      )}
    </button>
  )
}

function LensChip({ id, onRemove }: { id: LensId; onRemove: () => void }) {
  return (
    <span className='group inline-flex items-center gap-1 h-6 ps-2 pe-1 rounded-full bg-indigo-50 text-indigo-700 text-[11.5px] font-medium'>
      <Icon name={LENS_ICON[id]} type='reg' className='size-3 bg-indigo-500' />
      <span className='truncate max-w-[120px]'>{LENS_LABEL[id]}</span>
      <button
        type='button'
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={`הסר ${LENS_LABEL[id]}`}
        className='shrink-0 inline-flex items-center justify-center size-4 rounded-full hover:bg-indigo-100 transition-colors'
      >
        <Icon name='xmark' type='reg' className='size-2.5 bg-indigo-500' />
      </button>
    </span>
  )
}

function FileChip({ item, onRemove }: { item: AttachmentItem; onRemove: () => void }) {
  const label = ATTACHMENT_STATUS_LABEL[item.status]
  const tone = item.status === 'unreadable' || item.status === 'error' ? 'text-gray-400' : 'text-gray-600'
  return (
    <span className='group inline-flex items-center gap-1 h-6 ps-2 pe-1 rounded-full bg-gray-100 text-gray-700 text-[11.5px] font-medium'>
      <Icon name='paperclip' type='reg' className='size-3 bg-gray-500' />
      <span className='truncate max-w-[120px]' title={item.file.name}>
        {item.file.name}
      </span>
      {label && <span className={`text-[10px] font-normal ${tone}`}>{label}</span>}
      <button
        type='button'
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={`הסר ${item.file.name}`}
        className='shrink-0 inline-flex items-center justify-center size-4 rounded-full hover:bg-gray-200 transition-colors'
      >
        <Icon name='xmark' type='reg' className='size-2.5 bg-gray-500' />
      </button>
    </span>
  )
}

const ATTACHMENT_STATUS_LABEL: Record<AttachmentItem['status'], string> = {
  reading: 'קורא',
  ready: '',
  partial: 'חלקי',
  unreadable: 'לא נקרא',
  uploading: 'מעלה',
  error: 'שגיאה',
}

function extractionStatus(extracted: ExtractedAttachment): AttachmentItem['status'] {
  if (extracted.kind === 'text') return extracted.truncated ? 'partial' : 'ready'
  if (extracted.kind === 'image') return 'ready'
  return 'unreadable'
}

function ToolsPopover({
  actions,
  loadingId,
  onSelect,
}: {
  actions: CopilotSuggestedAction[]
  loadingId: CopilotActionId | null
  onSelect: (id: PredefinedCopilotActionId) => void
}) {
  return (
    <div
      role='menu'
      className={[
        'absolute bottom-full mb-2 inline-flex flex-col gap-0.5',
        'rounded-2xl bg-white border border-gray-200 p-1.5 min-w-[200px]',
        'shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]',
        'start-2',
      ].join(' ')}
      style={{ animation: 'cp-pop-in 140ms ease-out' }}
    >
      <style>{POP_KEYFRAMES}</style>
      {actions.map((action) => {
        const isLoading = loadingId === action.id
        return (
          <button
            key={action.id}
            type='button'
            role='menuitem'
            onClick={() => isKnownActionId(action.id) && onSelect(action.id)}
            disabled={loadingId !== null}
            data-action-id={action.id}
            className='group flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start hover:bg-gray-50 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
          >
            {isLoading ? (
              <span
                className='inline-block size-3 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin shrink-0'
                aria-hidden='true'
              />
            ) : (
              <Icon
                name='sparkles'
                type='reg'
                className='size-3 bg-gray-400 group-hover:bg-indigo-500 transition-colors shrink-0'
              />
            )}
            <span className='text-[12.5px] text-gray-700 group-hover:text-gray-900 truncate'>{action.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function AttachPopover({
  selected,
  onToggle,
  onUpload,
  onClose,
}: {
  selected: LensId[]
  onToggle: (id: LensId) => void
  onUpload: () => void
  onClose: () => void
}) {
  return (
    <div
      role='menu'
      className={[
        'absolute bottom-full mb-2 inline-flex flex-col gap-0.5',
        'rounded-2xl bg-white border border-gray-200 p-1.5 min-w-[220px]',
        'shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]',
        'start-2',
      ].join(' ')}
      style={{ animation: 'cp-pop-in 140ms ease-out' }}
    >
      <style>{POP_KEYFRAMES}</style>
      <div className='px-2.5 pt-1 pb-1 text-[10.5px] text-gray-400 tracking-wide'>הוסף הקשר</div>
      {LENS_IDS.map((id) => {
        const isSelected = selected.includes(id)
        return (
          <button
            key={id}
            type='button'
            role='menuitemcheckbox'
            aria-checked={isSelected}
            onClick={() => {
              onToggle(id)
              onClose()
            }}
            className={[
              'group flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start',
              'transition-colors duration-150',
              isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50',
            ].join(' ')}
          >
            <Icon
              name={LENS_ICON[id]}
              type='reg'
              className={`size-3.5 shrink-0 transition-colors ${isSelected ? 'bg-indigo-500' : 'bg-gray-400 group-hover:bg-indigo-500'}`}
            />
            <span
              className={`text-[12.5px] truncate transition-colors ${isSelected ? 'text-indigo-700' : 'text-gray-700 group-hover:text-gray-900'}`}
            >
              {LENS_LABEL[id]}
            </span>
            {isSelected && (
              <Icon name='check' type='reg' className='ms-auto size-3 bg-indigo-500 shrink-0' aria-hidden='true' />
            )}
          </button>
        )
      })}

      <div className='my-1 h-px bg-gray-100' role='separator' aria-hidden='true' />

      <button
        type='button'
        role='menuitem'
        onClick={onUpload}
        className='group flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-start hover:bg-gray-50 transition-colors duration-150'
      >
        <Icon
          name='arrow-up-from-bracket'
          type='reg'
          className='size-3.5 shrink-0 bg-gray-400 group-hover:bg-indigo-500 transition-colors'
        />
        <span className='text-[12.5px] text-gray-700 group-hover:text-gray-900 truncate'>העלאת קובץ</span>
      </button>
    </div>
  )
}

function isKnownActionId(id: string): id is PredefinedCopilotActionId {
  return id === 'draft-followup-message' || id === 'next-best-step'
}

function ModeButton({
  open,
  disabled,
  mode,
  onToggle,
}: {
  open: boolean
  disabled: boolean
  mode: CopilotMode
  onToggle: () => void
}) {
  return (
    <button
      type='button'
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup='menu'
      aria-expanded={open}
      aria-label={`מצב AI: ${mode.label}`}
      title={`מצב AI: ${mode.label}`}
      className={[
        'shrink-0 inline-flex items-center gap-1 h-7 ps-2 pe-1.5 rounded-full transition-colors duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        open ? 'bg-indigo-50' : 'hover:bg-gray-50',
      ].join(' ')}
    >
      <Icon
        name={mode.icon}
        type='reg'
        className={`size-3.5 transition-colors ${open ? 'bg-indigo-500' : 'bg-gray-500'}`}
      />
      <span
        className={`text-[12px] font-medium leading-none transition-colors ${open ? 'text-indigo-700' : 'text-gray-700'}`}
      >
        {mode.label}
      </span>
      <Icon
        name='chevron-down'
        type='reg'
        className={`size-2.5 transition-colors ${open ? 'bg-indigo-500' : 'bg-gray-400'}`}
      />
    </button>
  )
}

function ModePopover({
  activeId,
  onSelect,
}: {
  activeId: CopilotModeId
  onSelect: (id: CopilotModeId) => void
}) {
  return (
    <div
      role='menu'
      className={[
        'absolute bottom-full mb-2 inline-flex flex-col gap-0.5',
        'rounded-2xl bg-white border border-gray-200 p-1.5 min-w-[240px]',
        'shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]',
        'end-2',
      ].join(' ')}
      style={{ animation: 'cp-pop-in 140ms ease-out' }}
    >
      <style>{POP_KEYFRAMES}</style>
      <div className='px-2.5 pt-1 pb-1 text-[10.5px] text-gray-400 tracking-wide'>מצב AI</div>
      {COPILOT_MODES.map((mode) => {
        const isSelected = mode.id === activeId
        return (
          <button
            key={mode.id}
            type='button'
            role='menuitemradio'
            aria-checked={isSelected}
            onClick={() => onSelect(mode.id)}
            className={[
              'group flex items-start gap-2 w-full px-2.5 py-2 rounded-xl text-start transition-colors duration-150',
              isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50',
            ].join(' ')}
          >
            <Icon
              name={mode.icon}
              type='reg'
              className={`size-3.5 shrink-0 mt-0.5 transition-colors ${isSelected ? 'bg-indigo-500' : 'bg-gray-400 group-hover:bg-indigo-500'}`}
            />
            <div className='flex-1 min-w-0'>
              <div className='flex items-center gap-1.5'>
                <span
                  className={`text-[12.5px] font-medium transition-colors ${isSelected ? 'text-indigo-700' : 'text-gray-700 group-hover:text-gray-900'}`}
                >
                  {mode.label}
                </span>
                {mode.requiredTier === 'pro' && (
                  <span
                    className='text-[9.5px] font-bold tracking-wider px-1.5 py-px rounded bg-gray-900 text-white'
                    aria-label='זמין ב-Pro'
                  >
                    PRO
                  </span>
                )}
                {isSelected && (
                  <Icon name='check' type='reg' className='size-3 bg-indigo-500 shrink-0' aria-hidden='true' />
                )}
              </div>
              <p
                className={`text-[10.5px] leading-snug mt-0.5 transition-colors ${isSelected ? 'text-indigo-600/80' : 'text-gray-500'}`}
              >
                {mode.description}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

const POP_KEYFRAMES = `
  @keyframes cp-pop-in {
    from { opacity: 0; transform: translateY(4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    [role="menu"] { animation: none !important; }
  }
`
