'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '.'
import { debounce } from '@/lib/hooksNEvents'
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
}

export function SelectSearch({
  inputCls = '',
  obj = null,
  options = [],
  name = '',
  lbl = '',
  val = 'id',
  show = 'name',
  placeholder = 'חיפוש...',
  className = '',
  selected = null,
  initShow = null,
  searchFunc,
  onSelectOpt,
  onClear,
  required = true,
}: Props) {
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
    inputRef.current.value = el[show]
    valueRef.current.value = el[val]
    setIsOpen(false)
    if (onSelectOpt) onSelectOpt(el)
  }

  const { listboxId, highlight, setHighlight, optionRefs, onKeyDown } = useSelectSearchKeyboard({
    data,
    isOpen,
    setIsOpen,
    onSelect,
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
              className={`px-3 py-0.5 rounded w-full whitespace-nowrap text-right ${
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
