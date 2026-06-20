'use client'

import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react'
import type { CopilotActionId } from '@/lib/copilot/copilotResponse'
import type { LensId } from '@/lib/ai/prompts/leadAskQuestion'
import { COPILOT_MAX_QUESTION_CHARS } from '@/lib/copilot/attachments'
import { type CopilotMode, type CopilotModeId } from '@/lib/ai/copilotModes'
import { AttachButton, ModeButton, SendButton, ToolsButton } from './CopilotButtons'
import { FileChip, LensChip } from './CopilotChips'
import type { AttachmentItem } from './constants'

// The framed input box: textarea + lens/file chips + bottom toolbar.
// All callbacks and state are passed in so the parent owns submit logic and
// popover orchestration.
export function CopilotComposerInputBox(props: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  setValue: Dispatch<SetStateAction<string>>
  placeholder: string
  disabled: boolean
  onTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  lenses: LensId[]
  onRemoveLens: (id: LensId) => void
  attachedFiles: AttachmentItem[]
  onRemoveFile: (id: string) => void
  fileError: string | null
  attachOpen: boolean
  setAttachOpen: Dispatch<SetStateAction<boolean>>
  toolsOpen: boolean
  setToolsOpen: Dispatch<SetStateAction<boolean>>
  modeOpen: boolean
  setModeOpen: Dispatch<SetStateAction<boolean>>
  loadingId: CopilotActionId | null
  toolsDisabled: boolean
  attachDisabled: boolean
  modeId: CopilotModeId
  mode: CopilotMode
  sendReady: boolean
  submit: () => void
  preparingFiles: boolean
}) {
  const {
    textareaRef,
    value,
    setValue,
    placeholder,
    disabled,
    onTextareaKeyDown,
    lenses,
    onRemoveLens,
    attachedFiles,
    onRemoveFile,
    fileError,
    attachOpen,
    setAttachOpen,
    toolsOpen,
    setToolsOpen,
    modeOpen,
    setModeOpen,
    loadingId,
    toolsDisabled,
    attachDisabled,
    mode,
    sendReady,
    submit,
    preparingFiles,
  } = props

  return (
    <div
      className={[
        'block w-full rounded-md bg-white border border-gray-200',
        'shadow-[0_4px_18px_-8px_rgba(15,23,42,0.12),0_1px_3px_rgba(15,23,42,0.04)]',
        'focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary',
        'transition-all duration-200',
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
        className='w-full resize-none bg-transparent border-0 px-4 pt-3 pb-1 text-md font-medium leading-normal text-gray-900 placeholder:text-gray-700 focus:outline-none focus:ring-0 disabled:cursor-not-allowed'
        style={{ minHeight: 36 }}
      />

      {(lenses.length > 0 || attachedFiles.length > 0) && (
        <div className='flex flex-wrap items-center gap-1 px-3 pb-1'>
          {lenses.map((id) => (
            <LensChip key={`lens-${id}`} id={id} onRemove={() => onRemoveLens(id)} />
          ))}
          {attachedFiles.map((item) => (
            <FileChip key={item.id} item={item} onRemove={() => onRemoveFile(item.id)} />
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
            mode={mode}
            onToggle={() => {
              setModeOpen((v) => !v)
              setAttachOpen(false)
              setToolsOpen(false)
            }}
          />
          <SendButton ready={sendReady} onClick={submit} loading={loadingId === 'ask-question' || preparingFiles} />
        </div>
      </div>
    </div>
  )
}
