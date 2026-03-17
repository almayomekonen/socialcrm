'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon'
import { Input } from '.'
import { debounce } from '@/lib/hooksNEvents'

type Props = {
  options?: any[]
  selected?: any[]
  val?: string
  show?: string
  fetchKey?: string
  lbl?: string
  returnShow?: string
  selectedShow?: any[]
  searchFunc?: (value: string) => Promise<any[]>
  onSelectOpt?: (el: any) => void
} & React.InputHTMLAttributes<HTMLInputElement>

export function MultiSelectSearch({
  options = [],
  selected = [],
  val = 'id',
  show = 'name',
  fetchKey = 'name',
  lbl = '',
  searchFunc,
  returnShow = null,
  selectedShow = null,
  placeholder = 'חיפוש...',

  onSelectOpt,
  ...props
}: Props) {
  const [state, setState] = useState(false)

  const render = () => setState(!state)

  const optsRef = useRef(formatOptions(options))
  const opts = optsRef.current

  const [data, setData] = useState<any[]>(opts)
  const [isOpen, setIsOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  const debouncedSearch = useMemo(
    () =>
      debounce(async (val, setter) => {
        if (searchFunc) {
          const res = await searchFunc(val)
          setter(res)
        }
      }, 50),
    [searchFunc]
  )

  const valuesRef = useRef<Set<any>>(new Set(selected.map(String)))

  let initialShows = opts.filter((el) => selected.some((s) => String(s) === String(el[val]))).map((el) => el[show])
  if (selectedShow) initialShows = selectedShow

  const showRef = useRef<any>(new Set(initialShows))
  const inputRef = useRef<any>(null)

  // NEW ----------------
  const prevSelectedRef = useRef<string>(JSON.stringify(selected))

  useEffect(() => {
    const currentSelectedStr = JSON.stringify(selected)
    if (prevSelectedRef.current !== currentSelectedStr) {
      prevSelectedRef.current = currentSelectedStr

      const newValues = new Set(selected.map(String))
      valuesRef.current = newValues

      let initialShows = opts.filter((el) => selected.some((s) => String(s) === String(el[val]))).map((el) => el[show])
      if (selectedShow) initialShows = selectedShow
      showRef.current = new Set(initialShows)

      render()
    }
  }, [selected, opts, val, show, selectedShow])
  // NEW ----------------

  async function onChange(value) {
    if (value.trim().length === 0) return setData(opts)
    if (searchFunc) {
      if (value.length < 2) return
      return debouncedSearch(value, setData)
    }
    const res = opts.filter((el) => el[show].includes(value))

    if (res.length === 0) return setData(opts)
    setData(res)
  }

  function onSelect(e, el) {
    e.preventDefault()
    const key = String(el[val])

    if (valuesRef.current.has(String(key))) valuesRef.current.delete(String(key))
    else valuesRef.current.add(key)
    showRef.current.has(el[show]) ? showRef.current.delete(el[show]) : showRef.current.add(el[show])
    if (onSelectOpt) onSelectOpt(el)
    render()
  }
  function onSelectAll(e) {
    e.preventDefault()
    data.forEach((el) => {
      const key = String(el[val])
      if (!valuesRef.current.has(key)) {
        valuesRef.current.add(key)
        showRef.current.add(el[show])
        if (onSelectOpt) onSelectOpt(el)
      }
    })
    console.log('onSelectAll', valuesRef.current, showRef.current)
    render()
  }

  function onDeselectAll(e) {
    e.preventDefault()
    data.forEach((el) => {
      const key = String(el[val])
      if (valuesRef.current.has(key)) {
        valuesRef.current.delete(key)
        showRef.current.delete(el[show])
        if (onSelectOpt) onSelectOpt(el)
      }
    })
    console.log('onDeselectAll', valuesRef.current, showRef.current)
    render()
  }

  function onOpen() {
    setIsOpen(true)
    onChange(inputRef.current.value)
  }

  const isSelected = (key) => valuesRef.current.has(String(key))

  const isAllSelected = data.length > 0 && data.every((el) => isSelected(el[val]))

  const length = Array.from(showRef.current).length

  const itemCls = 'flex gap-3 hover:bg-gray-50 px-3 py-0.5 w-full '

  return (
    <div className={`relative ${props.className}`}>
      <Input
        lbl={lbl + (length > 0 ? ` (${length})` : '')}
        ref={inputRef}
        onFocus={onOpen}
        onBlur={() => setIsOpen(false)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={false}
        autoComplete='off'
        tooltip={Array.from(showRef.current).join(', ')}
      />

      <Input
        className='absolute bottom-0 right-0 -z-50'
        name={props.name + `[,]`}
        value={Array.from(valuesRef.current.keys())}
        required={props.required || false}
        onChange={() => {}}
      />

      {returnShow && (
        <input type='hidden' name={returnShow + `[]`} value={Array.from(showRef.current.keys())} onChange={() => {}} />
      )}

      {isOpen && data.length > 0 && (
        <div
          style={{ minWidth: `${inputRef.current?.offsetWidth}px` }}
          ref={popRef}
          className='absolute top-full right-0 z-999 border border-gray-300 rounded-md  scrollbar-slim max-h-50 overflow-y-auto bg-white'
        >
          <button type='button' onMouseDown={isAllSelected ? onDeselectAll : onSelectAll} className={itemCls}>
            <Icon name={isAllSelected ? 'square-check' : 'square'} />
            {isAllSelected ? 'הסר הכל' : 'בחר הכל'}
          </button>
          {data.map((el) => {
            const selected = isSelected(el[val])
            return (
              <button type='button' key={el[val]} onMouseDown={(e) => onSelect(e, el)} className={itemCls}>
                <Icon name={selected ? 'square-check' : 'square'} />
                {el[show]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function formatOptions(options: any[]) {
  let res = options
  if (typeof options[0] === 'string') res = options.map((opt) => ({ id: opt, name: opt }))
  return res
}
