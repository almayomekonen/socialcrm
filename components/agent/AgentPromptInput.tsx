'use client'

/**
 * NOTE: this file is 345 lines and intentionally over the 250-line soft limit
 * (architecture-rules.md §6). It is ONE control — a single card whose height,
 * width, padding, scroll fades and five overlaid children are all driven by the
 * same two pieces of state (`expanded`, `recording`), and most of its length is
 * the transition bookkeeping that makes those two states one morph rather than
 * a swap. Everything separable is already a sibling: the icons, the morphing
 * label, the scope popover, the attachment strip and preview, the dictation
 * hook, the autosize hook. Splitting the remainder would mean threading a dozen
 * props and three refs between micro-components that can never render apart.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import AgentScopeSelect from './AgentScopeSelect'
import MorphingText from './MorphingText'
import { AttachmentPreview, AttachmentThumb, type Attachment } from './AgentAttachments'
import AgentSendControl from './AgentSendControl'
import AgentVoiceStatus from './AgentVoiceStatus'
import { DepthBarsIcon, MicIcon, PlusIcon } from './promptIcons'
import { useVoiceRecorder } from './useVoiceRecorder'
import { mergeTranscriptIntoDraft } from '@/lib/agent/voice/limits'

const SPRING = 'max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
const SMOOTH = 'max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.15s ease-out'

/**
 * The two pill controls, in SocialCRM's own terms.
 *
 * The reference names foreign products (GPT / Opus / Gemini) and an abstract
 * "effort". Neither is a thing a נציג can act on, and printing another vendor's
 * model name in this product would be a claim about what runs behind it that
 * nothing here can keep. Both lists are props: swap them in one line if you want
 * literal model names instead.
 */
const DEFAULT_SCOPES = ['כל העסק', 'לידים', 'שיחות', 'משימות']
const DEFAULT_DEPTHS = ['מהיר', 'רגיל', 'מעמיק']

export type PromptMeta = { scope: string; depth: string; attachments: File[] }

export default function AgentPromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'שאל את הסוכן...',
  scopes = DEFAULT_SCOPES,
  depths = DEFAULT_DEPTHS,
  maxAttachments = 6,
  className,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: (value: string, meta: PromptMeta) => void
  placeholder?: string
  scopes?: string[]
  depths?: string[]
  maxAttachments?: number
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [smooth, setSmooth] = useState(false)
  const [scope, setScope] = useState(scopes[0])
  const [depthIndex, setDepthIndex] = useState(1)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [preview, setPreview] = useState<{ attachment: Attachment; rect: DOMRect } | null>(null)
  const [textareaHeight, setTextareaHeight] = useState(68)
  const [scrolls, setScrolls] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const topFade = useRef<HTMLDivElement>(null)
  const bottomFade = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  const setValue = useCallback((next: string) => { setSmooth(true); onChange(next) }, [onChange])
  /**
   * Voice is an input method: the transcript is merged into whatever is already
   * in the box (never replacing it) and stops there. The rep reads, edits and
   * sends it through `submit()` like anything typed.
   */
  const voice = useVoiceRecorder({ onTranscript: (text) => setValue(mergeTranscriptIntoDraft(valueRef.current, text)) })
  const voiceBusy = voice.status !== 'idle'
  const recording = voice.status === 'recording'

  const hasAttachments = attachments.length > 0
  const hasValue = value.trim() !== '' || hasAttachments
  const containerHeight = Math.max(116, textareaHeight + 48)

  const updateFades = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (topFade.current) topFade.current.style.opacity = String(Math.min(scrollTop / 20, 1))
    if (bottomFade.current) {
      const below = scrollHeight - clientHeight - scrollTop
      bottomFade.current.style.opacity = String(Math.min(Math.max(below - 16, 0) / 10, 1))
    }
  }, [])

  // Height is measured from a zeroed box, then restored, so the textarea can
  // shrink again when text is deleted — reading scrollHeight against the current
  // height only ever grows it.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const current = el.style.height
    el.style.transition = 'none'
    el.style.height = '0px'
    const scrollHeight = el.scrollHeight
    el.style.height = current
    void el.offsetHeight
    el.style.transition = ''
    const next = Math.max(68, Math.min(scrollHeight, 160))
    el.style.height = `${next}px`
    setTextareaHeight(next)
    setScrolls(scrollHeight > 160)
    setTimeout(updateFades, 0)
  }, [value, expanded, updateFades])

  // A live mic expands the composer too, so the voice status row sits in the
  // bottom-controls slot instead of on top of the collapsed placeholder.
  useEffect(() => {
    if ((hasValue || voiceBusy) && !expanded) { setSmooth(false); setExpanded(true) }
  }, [hasValue, voiceBusy, expanded])

  useEffect(() => {
    if (!expanded || voiceBusy) return
    const t = setTimeout(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 50)
    return () => clearTimeout(t)
  }, [expanded, voiceBusy])

  useEffect(() => {
    if (!scopeOpen) return
    const onDown = (e: globalThis.MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setScopeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [scopeOpen])

  useEffect(() => () => { attachments.forEach((a) => URL.revokeObjectURL(a.url)) }, [attachments])

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (rootRef.current?.contains(e.relatedTarget as Node)) return
    if (!hasValue && !voiceBusy) { setSmooth(false); setExpanded(false); setScopeOpen(false) }
  }

  function submit() {
    // Nothing is sent while the mic is live or a transcript is still coming.
    if (!hasValue || voiceBusy) return
    setSmooth(false)
    onSubmit(value, { scope, depth: depths[depthIndex], attachments: attachments.map((a) => a.file) })
    onChange('')
    attachments.forEach((a) => URL.revokeObjectURL(a.url))
    setAttachments([])
    setExpanded(false)
    setScopeOpen(false)
  }

  function chooseFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (!files.length) return
    if (!expanded) { setSmooth(false); setExpanded(true) } else setSmooth(true)
    for (const file of files.slice(0, Math.max(0, maxAttachments - attachments.length))) {
      const url = URL.createObjectURL(file)
      const img = new Image()
      const add = (w: number, h: number) =>
        setAttachments((prev) => [...prev, { id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`, file, url, name: file.name, width: w, height: h }])
      img.onload = () => add(img.naturalWidth, img.naturalHeight)
      img.onerror = () => add(800, 600)
      img.src = url
    }
  }

  function removeAttachment(id: string) {
    setSmooth(true)
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((a) => a.id !== id)
    })
  }

  /**
   * What the one action control currently is. `idle` is the honest fourth case:
   * nothing typed AND no dictation available (no SpeechRecognition, or a
   * refused microphone), so the button has nothing to do and says so by being
   * disabled rather than offering a mic that cannot record.
   */
  const mode: 'send' | 'mic' | 'stop' | 'busy' | 'idle' = recording
    ? 'stop'
    : voiceBusy
      ? 'busy'
      : hasValue
        ? 'send'
        : voice.supported
          ? 'mic'
          : 'idle'

  function actionClick(e: MouseEvent) {
    e.preventDefault()
    if (recording) voice.stop()
    else if (voiceBusy) return
    else if (hasValue) submit()
    else if (voice.supported) void voice.start()
  }

  return (
    <>
      <div
        ref={rootRef}
        onBlur={handleBlur}
        className={cn('relative mx-auto flex w-full flex-col', className)}
        style={{
          maxWidth: expanded ? 760 : 520,
          transition: smooth ? 'max-width 0.15s ease-out' : 'max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      >
        <input ref={fileRef} type='file' accept='image/*' multiple onChange={chooseFiles} className='hidden' tabIndex={-1} aria-hidden='true' />

        {/* Attachment strip, sliding out from behind the card. */}
        <div
          aria-hidden={!hasAttachments}
          style={{ height: hasAttachments && expanded ? 68 : 0, transition: smooth ? 'height 0.15s ease-out' : 'height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}
          className='relative z-0 w-full overflow-hidden'
        >
          <div
            style={{
              position: 'absolute', bottom: -8, insetInlineStart: 20, insetInlineEnd: 20, height: 68,
              transform: hasAttachments && expanded ? 'translateY(0)' : 'translateY(100%)',
              opacity: hasAttachments && expanded ? 1 : 0,
              transition: smooth ? 'transform 0.15s ease-out, opacity 0.15s ease-out' : 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out',
            }}
            className='flex items-start gap-2 overflow-x-auto rounded-t-md border border-b-0 bg-white px-2 pb-1 pt-2 scrollbar-slim'
          >
            {attachments.map((a, i) => (
              <AttachmentThumb key={a.id} attachment={a} index={i} onRemove={removeAttachment} onOpen={(att, rect) => setPreview({ attachment: att, rect })} />
            ))}
          </div>
        </div>

        {/* The composer, in the app's own input language: white surface,
            hairline border, rounded-md, and the standard focus outline. */}
        <div
          onMouseDown={(e) => {
            if (expanded && e.target !== textareaRef.current && !voiceBusy) {
              e.preventDefault()
              textareaRef.current?.focus()
            }
          }}
          style={{
            height: expanded ? containerHeight : 52,
            transition: smooth ? SMOOTH : SPRING,
            overflow: expanded ? 'visible' : 'hidden',
          }}
          className={cn(
            'relative z-10 w-full rounded-md border bg-white',
            'transition-[border-color] duration-200 focus-within:border-primary',
            expanded ? 'cursor-text' : 'cursor-default',
            /* Mobile: the bottom row (controls or voice status, level meter,
               action button) is a real flex row in flow at the bottom of the
               card, not absolute pieces — nothing in it can land outside the
               input. The text layers above it stay as they are; their `pe-14`
               still reserves the action button's inline end. */
            'in-[[data-mobile-workspace]]:flex in-[[data-mobile-workspace]]:items-end in-[[data-mobile-workspace]]:gap-1 in-[[data-mobile-workspace]]:px-2 in-[[data-mobile-workspace]]:py-1.5',
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => { voice.clearError(); setValue(e.target.value) }}
            onScroll={updateFades}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
              if (e.key === 'Escape' && !hasValue) { setSmooth(false); setExpanded(false); setScopeOpen(false) }
            }}
            placeholder={placeholder}
            aria-label='שאל את הסוכן'
            enterKeyHint='send'
            disabled={voiceBusy}
            style={{ transition: smooth ? 'height 0.15s ease-out' : 'opacity 0.3s ease-out, transform 0.3s ease-out, height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}
            /* 16px so iOS Safari does not zoom the page on focus. */
            className={cn(
              'scrollbar-slim absolute inset-x-0 top-0 z-1 w-full resize-none bg-transparent ps-5 pe-14 py-3.5 text-base leading-6 text-ink outline-none placeholder:font-medium placeholder:text-gray-500',
              expanded ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-1 scale-95 opacity-0',
              scrolls ? 'overflow-y-auto' : 'overflow-y-hidden',
            )}
          />

          <div ref={topFade} className='pointer-events-none absolute start-5 end-14 top-0 z-2 h-8 bg-gradient-to-b from-white via-white/80 to-transparent' />
          <div
            ref={bottomFade}
            className='pointer-events-none absolute start-5 end-14 z-2 h-8 bg-gradient-to-t from-white via-white/80 to-transparent'
            style={{ opacity: 0, top: `${textareaHeight - 32}px`, transition: smooth ? 'top 0.15s ease-out' : 'top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}
          />

          <button
            type='button'
            onClick={() => { setSmooth(false); setExpanded(true) }}
            style={{ transition: smooth ? 'none' : 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}
            className={cn(
              'absolute inset-x-0 top-0 z-1 cursor-text ps-5 pe-14 py-4 text-start text-base font-medium leading-5 text-gray-500 outline-none',
              expanded ? 'pointer-events-none translate-y-1 scale-105 opacity-0' : 'translate-y-0 scale-100 opacity-100',
            )}
            aria-label='פתיחת תיבת ההודעה'
          >
            {placeholder}
          </button>

          {/* Bottom controls. Hidden while voice input is busy: the voice status row takes their place. */}
          <div
            className={cn(
              'absolute bottom-2 start-3 end-14 z-10 flex items-center gap-0 transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]',
              expanded && !voiceBusy ? 'pointer-events-auto translate-y-0 opacity-100 blur-0' : 'pointer-events-none translate-y-2 opacity-0 blur-sm',
              'in-[[data-mobile-workspace]]:static in-[[data-mobile-workspace]]:min-w-0 in-[[data-mobile-workspace]]:flex-1',
              // The voice status row takes this slot while voice is busy.
              voiceBusy && 'in-[[data-mobile-workspace]]:hidden',
            )}
          >
            <AgentScopeSelect scopes={scopes} value={scope} onChange={setScope} open={scopeOpen} onOpenChange={setScopeOpen} />

            <button
              type='button'
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); setDepthIndex((p) => (p + 1) % depths.length) }}
              aria-label={`עומק הניתוח: ${depths[depthIndex]}`}
              className='group flex items-center gap-1 rounded-md px-2 py-1 text-gray-600 outline-none transition-colors duration-200 hover:bg-gray-100 hover:text-ink focus-visible:ring-2 focus-visible:ring-primary'
            >
              <DepthBarsIcon level={depthIndex} />
              <span className='select-none text-xs font-semibold'><MorphingText text={depths[depthIndex]} /></span>
            </button>

            {voice.supported && hasValue && (
              /* With a draft in the box the action button is "send", so recording
                 more lives here; the transcript is appended to the draft. */
              <button
                type='button'
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); void voice.start() }}
                aria-label='הקלטה קולית'
                className='ms-auto flex size-7 items-center justify-center rounded-md text-gray-600 outline-none transition-colors duration-200 hover:bg-gray-100 hover:text-ink focus-visible:ring-2 focus-visible:ring-primary'
              >
                <MicIcon />
              </button>
            )}

            <button
              type='button'
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
              disabled={attachments.length >= maxAttachments}
              aria-label='הוספת תמונה'
              className={cn(
                voice.supported && hasValue ? '' : 'ms-auto',
                'flex size-7 items-center justify-center rounded-md text-gray-600 outline-none transition-colors duration-200 hover:bg-gray-100 hover:text-ink focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <PlusIcon />
            </button>
          </div>

          <AgentVoiceStatus status={voice.status} elapsedMs={voice.elapsedMs} onCancel={voice.cancel} />

          <AgentSendControl
            mode={mode}
            levels={voice.levels}
            recording={recording}
            disabled={mode === 'idle' || mode === 'busy'}
            onClick={actionClick}
          />
        </div>

        {/* Voice failures, under the box. The draft above is never touched. */}
        {voice.errorMessage && (
          <p role='alert' className='mt-1.5 px-1 text-start text-xs text-red-700'>
            {voice.errorMessage}
          </p>
        )}
      </div>

      {preview && <AttachmentPreview attachment={preview.attachment} originRect={preview.rect} onClose={() => setPreview(null)} />}
    </>
  )
}
