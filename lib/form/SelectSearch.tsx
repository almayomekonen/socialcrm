'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '.'
import { debounce } from '@/lib/hooksNEvents'
import { useT } from '@/lib/i18n/I18nProvider'
import { useSelectSearchKeyboard } from './useSelectSearchKeyboard'

type Props = {
  obj?: any
  options?: any[]
  name?: string
  lbl?: string
  val?: string
  show?: string
  placeholder?: string
  className?: string
  searchFunc?: (value: string) => Promise<any[]>
  onSelectOpt?: (el: any) => void
  selected?: any
  inputCls?: string
  initShow?: string
  required?: boolean
  /** Fired when the user empties the input. Lets a consumer drop its URL scope. */
  onClear?: () => void
  /**
   * Commit the raw typed text as a search. When provided, Enter with no row
   * explicitly highlighted searches for what the user typed instead of jumping
   * to the top suggestion — which is the only way a partial term like "ספי" can
   * ever reach the server. Consumers that are pickers, not searches, omit it and
   * keep the pick-the-top-match behaviour.
   */
  onSubmitText?: (text: string) => void
  /**
   * Every keystroke, including the first character. A live search consumer
   * debounces this itself; the suggestion query keeps its own threshold.
   */
  onSearchChange?: (text: string) => void
  /**
   * The text to put in the input when a suggestion is chosen. Defaults to the
   * suggestion's `show` field. The workspace search overrides it because `show`
   * is `details` — which carries the national id — while the search itself runs
   * on the plain name.
   */
  selectText?: (el: any) => string
}

export function SelectSearch({
  inputCls = '',
  obj = null,
  options = [],
  name = '',
  lbl = '',
  val = 'id',
  show = 'name',
  placeholder: placeholderProp,
  className = '',
  selected = null,
  initShow = null,
  searchFunc,
  onSelectOpt,
  onClear,
  onSubmitText,
  onSearchChange,
  selectText,
  required = true,
}: Props) {
  const t = useT()
  // Default placeholder in the interface language (Hebrew 'חיפוש...' outside a provider).
  const placeholder = placeholderProp ?? t('common.picker.search')
  const debouncedSearch = useMemo(
    () =>
      debounce(async (value, setter) => {
        if (searchFunc) {
          const res = await searchFunc(value)
          setter(res)
        }
      }, 50),
    [searchFunc]
  )
  const [state, setState] = useState(false)
  const render = () => setState(!state)

  const optsRef = useRef(formatOptions(options))
  const opts = optsRef.current

  const [data, setData] = useState<any[]>(opts)
  const [isOpen, setIsOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  let initialShow = initShow || (selected ? opts.find((el) => el[val] === selected)?.[show] : '')

  const inputRef = useRef<any>(initialShow)
  const valueRef = useRef<any>(selected)

  // NEW ----------------
  const prevSelectedRef = useRef<any>(selected)

  /**
   * Follow `initShow` whenever the OWNER changes it.
   *
   * The input stays uncontrolled on purpose: the DOM value is the source of
   * truth while typing, so text never lags a keystroke and the caret is never
   * moved. That means the owner — not this component — must decide when the box
   * should be overwritten. A live-search owner passes a value that changes ONLY
   * on external navigation (mount, back/forward, a cleared search) and never on
   * the echo of its own in-flight search, so this can stay a plain sync.
   */
  const prevInitShowRef = useRef<any>(initShow)
  useEffect(() => {
    if (prevInitShowRef.current === initShow) return
    prevInitShowRef.current = initShow
    if (inputRef.current) inputRef.current.value = initShow ?? ''
  }, [initShow])

  useEffect(() => {
    if (prevSelectedRef.current !== selected) {
      prevSelectedRef.current = selected

      const newShow = initShow || (selected ? opts.find((el) => el[val] === selected)?.[show] ?? '' : '')
      const showChanged = inputRef.current?.value !== newShow
      const valueChanged = valueRef.current?.value !== selected

      if (showChanged || valueChanged) {
        if (inputRef.current) inputRef.current.value = newShow
        if (valueRef.current) valueRef.current.value = selected
        if (showChanged || valueChanged) {
          render()
        }
      }
    }
  }, [selected, initShow, opts, val, show])
  // NEW ----------------

  async function onChange(value) {
    // Reported first and unconditionally: the TABLE search must see the very
    // first character, even though the suggestion query below still waits for
    // two before asking the server for suggestions.
    onSearchChange?.(value)
    if (value.trim().length === 0) {
      onClear?.()
      return setData(opts)
    }
    if (searchFunc) {
      if (value.length < 2) return
      return debouncedSearch(value, setData)
    }
    const exists = options.find((el) => el[show] === value)
    exists ? (valueRef.current.value = exists[val]) : (valueRef.current.value = '')

    const res = opts.filter((el) => el[show].includes(value))

    setData(res)
  }

  function onSelect(el) {
    const display = selectText ? selectText(el) : el[show]
    inputRef.current.value = display
    valueRef.current.value = el[val]
    setIsOpen(false)
    if (onSelectOpt) onSelectOpt(el)
  }

  /**
   * What Enter commits.
   *
   * An explicit highlight always wins — arrowing to a row and pressing Enter is
   * the same act as clicking it. Otherwise a search consumer commits the typed
   * text (so "ספי" searches for "ספי"), and a picker consumer keeps taking the
   * top match, which is what every non-search `SelectSearch` in the app has
   * always done. Returning false means "not mine" and lets the key through.
   */
  function onCommit(index: number): boolean {
    if (index >= 0 && data[index]) {
      onSelect(data[index])
      return true
    }
    const typed = (inputRef.current?.value ?? '').trim()
    if (onSubmitText) {
      if (!typed) return false
      setIsOpen(false)
      onSubmitText(typed)
      return true
    }
    if (data.length > 0) {
      onSelect(data[0])
      return true
    }
    return false
  }

  const { listboxId, highlight, setHighlight, optionRefs, onKeyDown } = useSelectSearchKeyboard({
    data,
    isOpen,
    setIsOpen,
    onCommit,
  })

  // function deselect() {
  //   inputRef.current.value = ''
  //   valueRef.current.value = ''
  //   if (onSelectOpt) onSelectOpt(null)
  //   render()
  // }

  function showFunc() {
    setIsOpen(true)
    onChange(inputRef.current.value)
  }

  return (
    <div className={`relative ${className}`}>
      <Input
        lbl={lbl}
        ref={inputRef}
        defaultValue={initialShow}
        onFocus={showFunc}
        onBlur={() => setIsOpen(false)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={false}
        className={inputCls}
        role='combobox'
        aria-expanded={isOpen && data.length > 0}
        aria-controls={isOpen && data.length > 0 ? listboxId : undefined}
        aria-activedescendant={isOpen && highlight >= 0 ? `${listboxId}-${highlight}` : undefined}
        aria-autocomplete='list'
        autoComplete='off'
      />

      <Input
        className='absolute top-0 right-0 -z-50 opacity-0'
        defaultValue={selected}
        name={name}
        ref={valueRef}
        value={obj?.[val]}
        required={required}
      />

      {isOpen && data.length > 0 && (
        <div
          style={{ minWidth: `${inputRef.current?.offsetWidth}px` }}
          ref={popRef}
          id={listboxId}
          role='listbox'
          className='absolute top-full right-0 z-9999 border border-gray-200 rounded-md  scrollbar-slim max-h-50 overflow-y-auto bg-white'
        >
          {data.map((el, i) => (
            <button
              key={el[val]}
              id={`${listboxId}-${i}`}
              ref={(node) => {
                optionRefs.current[i] = node
              }}
              role='option'
              aria-selected={i === highlight}
              // Mouse selection is unchanged: mousedown still fires before the
              // input's blur closes the list.
              onMouseDown={() => onSelect(el)}
              onMouseEnter={() => setHighlight(i)}
              type='button'
              className={`px-3 py-0.5 rounded w-full whitespace-nowrap text-start ${
                i === highlight ? 'bg-gray-100' : 'hover:bg-gray-100'
              }`}
            >
              {el[show]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function formatOptions(options: any[]) {
  if (typeof options[0] === 'string') return options.map((opt) => ({ id: opt, name: opt }))
  return options
}
