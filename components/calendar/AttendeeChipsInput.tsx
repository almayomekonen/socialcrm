'use client'

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { FormField } from '@/lib/form'

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,255}$/
const SEPARATORS = /[,;\s\n]+/

type Props = {
  value: string[]
  onChange: (emails: string[]) => void
  lbl?: string
  info?: string
  placeholder?: string
  disabled?: boolean
}

/**
 * Email-chips input. Controlled component — owns no email state, only its
 * own draft buffer and inline error. Commit on Enter, comma, semicolon,
 * Tab, blur, or a multi-email paste. Backspace on an empty draft removes
 * the last chip. Duplicates silently dropped; invalid emails surface a
 * single inline message.
 */
export default function AttendeeChipsInput({
  value,
  onChange,
  lbl,
  info,
  placeholder,
  disabled,
}: Props) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function commit(raw: string): { committed: number; invalid: string[] } {
    const candidates = raw
      .split(SEPARATORS)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (candidates.length === 0) return { committed: 0, invalid: [] }
    const next = [...value]
    const seen = new Set(next)
    const invalid: string[] = []
    let committed = 0
    for (const c of candidates) {
      if (!EMAIL_RE.test(c)) {
        invalid.push(c)
        continue
      }
      if (seen.has(c)) continue
      seen.add(c)
      next.push(c)
      committed++
    }
    if (committed > 0) onChange(next)
    return { committed, invalid }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      if (!draft.trim()) {
        if (e.key === 'Enter') e.preventDefault()
        return
      }
      e.preventDefault()
      const { committed, invalid } = commit(draft)
      if (invalid.length > 0) {
        setError(`כתובת לא תקינה: ${invalid[0]}`)
      } else if (committed > 0) {
        setDraft('')
        setError(null)
      }
    } else if (e.key === 'Tab' && draft.trim()) {
      const { committed, invalid } = commit(draft)
      if (committed > 0) setDraft('')
      if (invalid.length > 0) setError(`כתובת לא תקינה: ${invalid[0]}`)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1))
      setError(null)
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!SEPARATORS.test(text)) return // single email — let normal typing handle it
    e.preventDefault()
    const { committed, invalid } = commit(text)
    setDraft('')
    if (invalid.length > 0) {
      setError(
        invalid.length === 1
          ? `כתובת לא תקינה: ${invalid[0]}`
          : `${invalid.length} כתובות לא תקינות הושמטו`,
      )
    } else if (committed > 0) {
      setError(null)
    }
  }

  function handleBlur() {
    if (!draft.trim()) return
    const { committed, invalid } = commit(draft)
    if (committed > 0) {
      setDraft('')
      setError(null)
    } else if (invalid.length > 0) {
      setError(`כתובת לא תקינה: ${invalid[0]}`)
    }
  }

  function remove(email: string) {
    onChange(value.filter((e) => e !== email))
    setError(null)
  }

  const wrapperState = disabled
    ? 'opacity-50 pointer-events-none border-gray-200'
    : error
      ? 'border-red-500 focus-within:outline-2 focus-within:outline-red-200'
      : 'border-gray-200 focus-within:outline-2 focus-within:outline-blue-200'

  return (
    <FormField lbl={lbl} info={info} error={error ?? undefined}>
      <div
        className={`flex flex-wrap items-center gap-1.5 min-h-10 w-full px-2 py-1.5 rounded-md border bg-white transition-colors ${wrapperState}`}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((email) => (
          <Chip key={email} email={email} onRemove={() => remove(email)} disabled={disabled} />
        ))}
        <input
          ref={inputRef}
          type='email'
          className='flex-1 min-w-[140px] outline-none bg-transparent text-sm py-0.5'
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : undefined}
          disabled={disabled}
          autoComplete='off'
          autoCapitalize='off'
          spellCheck={false}
        />
      </div>
    </FormField>
  )
}

function Chip({
  email,
  onRemove,
  disabled,
}: {
  email: string
  onRemove: () => void
  disabled?: boolean
}) {
  return (
    <span className='inline-flex items-center gap-1 ps-2 pe-1 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-sm text-gray-900 max-w-full'>
      <span className='truncate max-w-[220px] font-medium' title={email}>
        {email}
      </span>
      {!disabled && (
        <button
          type='button'
          onClick={onRemove}
          aria-label={`הסר ${email}`}
          className='inline-flex items-center justify-center size-4 rounded-sm text-gray-400 hover:bg-gray-200 hover:text-red-600 transition-colors'
        >
          <svg viewBox='0 0 8 8' className='size-2.5' aria-hidden='true'>
            <path
              d='M1 1 L7 7 M7 1 L1 7'
              stroke='currentColor'
              strokeWidth='1.5'
              strokeLinecap='round'
            />
          </svg>
        </button>
      )}
    </span>
  )
}
