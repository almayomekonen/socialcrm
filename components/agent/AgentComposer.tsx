'use client'

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Icon from '@/lib/Icon'
import { useAutosizeTextarea } from './useAutosizeTextarea'

/** Ceiling before the textarea starts scrolling instead of growing (~7 lines). */
const MAX_TEXTAREA_PX = 184

/**
 * The composer — the strongest interaction on the agent page.
 *
 * TWO STATES, ONE BOX. Resting it is a single compact line; focused (or holding
 * text) it opens into a taller canvas with the send control in a reserved band
 * beneath the text. Both states are the SAME element with different padding and
 * min-height, which is what lets the change be a morph rather than a swap — a
 * second element cross-fading in would move the caret and lose the selection.
 *
 * RTL-FIRST, not a mirrored LTR box. Every inset is logical (`ps`/`pe`/`end`),
 * so the send control sits at the inline end in Hebrew and would sit at the
 * inline end in any LTR locale without a second stylesheet.
 *
 * NO ATTACHMENT CONTROL, DELIBERATELY. The reference input has one; this surface
 * has nothing behind it — no upload path, no agent tool that can read a file.
 * A visible control that cannot do its job is the "fake button" this project's
 * frontend guidelines call a defect, so it is absent rather than inert. It comes
 * back the day attachments are actually processed.
 *
 * NO VOICE CONTROL, for the same reason and one worse: the reference falls back
 * to GENERATING sample text when speech recognition is unavailable, which is a
 * fabricated user utterance.
 */
export default function AgentComposer({
  value,
  onChange,
  onSubmit,
  autoFocus = false,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  autoFocus?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)
  useAutosizeTextarea(textareaRef, value, MAX_TEXTAREA_PX)

  const canSend = value.trim().length > 0
  const expanded = focused || canSend

  function submit() {
    if (!canSend) return
    onSubmit()
    // Collapse back to the resting height: the hook only re-measures on value
    // change, and an emptied-but-still-tall box reads as a failed send.
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Shift+Enter keeps the newline. `enterKeyHint='send'` below makes the
    // mobile return key say so, so Enter-to-send is not a surprise on a phone.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={[
        'relative w-full rounded-[26px] border bg-surface',
        'transition-[min-height,box-shadow,border-color] duration-200 ease-out',
        'motion-reduce:transition-none',
        expanded
          ? 'min-h-27 border-primary/40 shadow-overlay'
          : 'min-h-13 border-border shadow-none hover:border-gray-300',
      ].join(' ')}
    >
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        enterKeyHint='send'
        aria-label='שאל את הסוכן'
        placeholder={expanded ? 'מה תרצה שהסוכן יעשה?' : 'שאל את הסוכן...'}
        /* text-base = 16px: anything smaller makes iOS Safari zoom the page on
           focus, which on a composer means the page jumps on every tap. */
        className={[
          'block w-full resize-none bg-transparent text-base leading-6 text-gray-900',
          'outline-none placeholder:text-gray-400',
          'transition-[padding] duration-200 ease-out motion-reduce:transition-none',
          expanded ? 'ps-5 pe-5 pt-4 pb-12' : 'ps-5 pe-14 py-3.5',
        ].join(' ')}
      />

      {/* Anchored to the inline end of the BOTTOM edge in both states: at the
          resting height that reads as vertically centred beside the text, and
          at the expanded height as a control in its own band. One position,
          so it never jumps mid-morph. */}
      <button
        type='submit'
        disabled={!canSend}
        aria-label='שליחה'
        className={[
          /* `tap-44`, not `size-11`: a 44px circle here crowds the composer at
             390px. The utility keeps the drawn 36px and extends the HIT AREA to
             44px on coarse pointers only — the project's existing answer to
             exactly this trade-off. */
          'tap-44 press absolute bottom-2 end-2 inline-flex size-9 items-center justify-center rounded-full',
          'transition-colors duration-150 motion-reduce:transition-none',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          canSend ? 'bg-primary hover:bg-primary-text' : 'bg-gray-100',
        ].join(' ')}
      >
        <Icon name='arrow-up' type='sol' className={`size-4 ${canSend ? 'bg-white' : 'bg-gray-400'}`} />
      </button>
    </form>
  )
}
