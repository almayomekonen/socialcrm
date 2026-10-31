'use client'

import dynamic from 'next/dynamic'
import { memo, useEffect, useRef, type RefObject } from 'react'
import type { Categories, EmojiStyle } from 'emoji-picker-react'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'

const HEBREW = translatorFor('he')

/** The library's category order (its `Categories` values, minus `custom`: no custom emojis are passed). */
const CATEGORY_KEYS = [
  ['suggested', 'inbox.emoji.categories.suggested'],
  ['smileys_people', 'inbox.emoji.categories.smileysPeople'],
  ['animals_nature', 'inbox.emoji.categories.animalsNature'],
  ['food_drink', 'inbox.emoji.categories.foodDrink'],
  ['travel_places', 'inbox.emoji.categories.travelPlaces'],
  ['activities', 'inbox.emoji.categories.activities'],
  ['objects', 'inbox.emoji.categories.objects'],
  ['symbols', 'inbox.emoji.categories.symbols'],
  ['flags', 'inbox.emoji.categories.flags'],
] as const

/**
 * The library's own words (category headers, the search Clear button) for a translated screen outside Hebrew.
 * Hebrew passes nothing, so the library keeps its built-in text exactly as before.
 */
function libraryText(t: Translator) {
  if (t.locale === 'he') return {}
  return {
    searchClearButtonLabel: t('inbox.emoji.clear'),
    categories: CATEGORY_KEYS.map(([category, key]) => ({ category: category as Categories, name: t(key) })),
  }
}

const loadingCls = 'flex h-[360px] w-full items-center justify-center text-sm text-gray-400'

/** The chunk-loading line for a translated caller (`next/dynamic` passes no props, so it reads the provider). */
function TranslatedLoading() {
  return <div className={loadingCls}>{useT()('inbox.emoji.loading')}</div>
}

const Picker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => <div className={loadingCls}>{HEBREW('inbox.emoji.loading')}</div>,
})

const TranslatedPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => <TranslatedLoading />,
})

/**
 * Floating emoji picker popover, anchored above its (position: relative) parent.
 * The heavy emoji-picker-react bundle is a separate chunk that starts loading
 * only on the first open (the component renders null until then), and stays
 * mounted afterwards so re-opens are instant.
 */
function EmojiPicker({
  open,
  onClose,
  onPick,
  triggerRef,
  translated = false,
}: {
  open: boolean
  /** reason: 'escape' closes via keyboard, 'outside' via click-away. Selection closes via onPick. */
  onClose: (reason: 'escape' | 'outside') => void
  onPick: (emoji: string) => void
  triggerRef: RefObject<HTMLElement | null>
  /** The caller's screen follows the interface language (the inbox composer, the questionnaire icon chooser). Off: Hebrew, as before. */
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const Chosen = translated ? TranslatedPicker : Picker
  const panelRef = useRef<HTMLDivElement>(null)
  const openedOnceRef = useRef(false)
  if (open) openedOnceRef.current = true

  // Latest-ref so the document listeners bind once per open, not once per
  // parent render (the composer re-renders on every keystroke).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current('escape')
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      onCloseRef.current('outside')
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, triggerRef])

  if (!openedOnceRef.current && !open) return null

  return (
    <div
      ref={panelRef}
      role='dialog'
      aria-label={t('inbox.emoji.dialog')}
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      className={`absolute bottom-full start-0 z-50 mb-2 w-80 max-w-[75vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl transition duration-150 ease-out focus:outline-none ${
        open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'
      }`}
    >
      <Chosen
        onEmojiClick={(d) => onPick(d.emoji)}
        emojiStyle={'native' as EmojiStyle}
        width='100%'
        height={360}
        searchPlaceHolder={t('inbox.emoji.search')}
        skinTonesDisabled
        previewConfig={{ showPreview: false }}
        lazyLoadEmojis
        {...(translated ? libraryText(t) : {})}
      />
    </div>
  )
}

// Memoized: with stable handler props the picker subtree skips the composer's
// per-keystroke re-renders entirely.
export default memo(EmojiPicker)
