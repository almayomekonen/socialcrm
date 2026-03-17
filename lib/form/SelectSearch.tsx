'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '.'
import { debounce } from '@/lib/hooksNEvents'

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

      const newShow = initShow || (selected ? opts.find((el) => el[val] === selected)?.[show] : '')
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
    if (value.trim().length === 0) return setData(opts)
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
    if (onSelectOpt) onSelectOpt(el)
  }

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
        placeholder={placeholder}
        required={false}
        className={inputCls}
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
          className='absolute top-full right-0 z-9999 border border-gray-300 rounded-md  scrollbar-slim max-h-50 overflow-y-auto bg-white'
        >
          {data.map((el) => (
            <button
              key={el[val]}
              onMouseDown={() => onSelect(el)}
              type='button'
              className='hover:bg-gray-100 px-3 py-0.5 rounded w-full whitespace-nowrap text-right'
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
