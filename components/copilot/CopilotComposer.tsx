'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CopilotActionId, PredefinedCopilotActionId } from '@/lib/copilot/copilotResponse'
import type { CopilotSuggestedAction } from '@/lib/copilot/copilotContext'
import { type LensId } from '@/lib/ai/prompts/leadAskQuestion'
import { useUser } from '@/lib/hooksNEvents'
import { type CopilotAttachmentPayload } from '@/lib/copilot/attachments'
import { DEFAULT_COPILOT_MODE_ID, getCopilotMode, type CopilotModeId } from '@/lib/ai/copilotModes'
import { readPersistedMode, writePersistedMode } from '@/lib/copilot/copilotModeState'
import { MAX_TEXTAREA_HEIGHT, UPLOAD_ACCEPT } from './composer/constants'
import { ToolsPopover } from './composer/ToolsPopover'
import { AttachPopover } from './composer/AttachPopover'
import { ModePopover } from './composer/ModePopover'
import { useComposerFiles } from './composer/useComposerFiles'
import { useOutsidePopoverClose } from './composer/useOutsidePopoverClose'
import { CopilotComposerInputBox } from './composer/CopilotComposerInputBox'
import { runComposerSubmit } from './composer/submitComposer'

type Props = {
  actions: CopilotSuggestedAction[]
  onAction: (id: PredefinedCopilotActionId) => void
  onSubmit: (text: string, lenses: LensId[], attachments: CopilotAttachmentPayload[], mode: CopilotModeId) => void
  loadingId: CopilotActionId | null
  placeholder: string
  leadId?: number | null
  disabled?: boolean
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
  const [toolsOpen, setToolsOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const [modeId, setModeId] = useState<CopilotModeId>(DEFAULT_COPILOT_MODE_ID)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const files = useComposerFiles()

  useEffect(() => {
    setModeId(readPersistedMode())
  }, [])

  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  const closeAllPopovers = useCallback(() => {
    setToolsOpen(false)
    setAttachOpen(false)
    setModeOpen(false)
  }, [])

  useOutsidePopoverClose({
    composerRef,
    anyOpen: toolsOpen || attachOpen || modeOpen,
    closeAll: closeAllPopovers,
  })

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

  const trimmed = value.trim()
  const filesReading = files.attachedFiles.some((item) => item.status === 'reading')
  const sendReady = !disabled && trimmed.length > 0 && loadingId === null && !filesReading && !files.preparingFiles
  const toolsDisabled = disabled || actions.length === 0
  const attachDisabled = disabled || files.preparingFiles

  async function submit() {
    if (!sendReady) return
    await runComposerSubmit({
      question: trimmed,
      lenses,
      modeId,
      files: files.attachedFiles,
      leadId,
      userId: user?.id ?? null,
      onSubmit,
      setFileError: files.setFileError,
      setPreparingFiles: files.setPreparingFiles,
      markAllUploading: files.markAllUploading,
      markAllError: files.markAllError,
      clearFiles: files.clearFiles,
      clearValue: () => setValue(''),
      clearLenses: () => setLenses([]),
    })
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div ref={composerRef} className='relative w-full'>
      <CopilotComposerInputBox
        textareaRef={textareaRef}
        value={value}
        setValue={setValue}
        placeholder={placeholder}
        disabled={disabled}
        onTextareaKeyDown={onTextareaKeyDown}
        lenses={lenses}
        onRemoveLens={removeLens}
        attachedFiles={files.attachedFiles}
        onRemoveFile={files.removeAttachedFile}
        fileError={files.fileError}
        attachOpen={attachOpen}
        setAttachOpen={setAttachOpen}
        toolsOpen={toolsOpen}
        setToolsOpen={setToolsOpen}
        modeOpen={modeOpen}
        setModeOpen={setModeOpen}
        loadingId={loadingId}
        toolsDisabled={toolsDisabled}
        attachDisabled={attachDisabled}
        modeId={modeId}
        mode={getCopilotMode(modeId)}
        sendReady={sendReady}
        submit={() => void submit()}
        preparingFiles={files.preparingFiles}
      />

      {toolsOpen && !toolsDisabled && (
        <ToolsPopover actions={actions} loadingId={loadingId} onSelect={handleSelectAction} />
      )}

      {attachOpen && !attachDisabled && (
        <AttachPopover selected={lenses} onToggle={toggleLens} onUpload={triggerFilePicker} onClose={() => setAttachOpen(false)} />
      )}

      {modeOpen && !disabled && <ModePopover activeId={modeId} onSelect={selectMode} />}

      <input
        ref={fileInputRef}
        type='file'
        multiple
        accept={UPLOAD_ACCEPT}
        onChange={files.onFilesPicked}
        className='sr-only'
        tabIndex={-1}
        aria-hidden='true'
      />
    </div>
  )
}
