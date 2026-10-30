'use client'

import { Input } from '@/lib/form'
import FileUploader from '@/components/files/FileUploader'
import type { FieldDescriptor } from '@/lib/billing/issuer/fields'

export function FieldRenderer({
  field,
  value,
  error,
  onChange,
  onBlur,
  disabled,
  translated = false,
}: {
  field: FieldDescriptor
  value: unknown
  error?: string
  onChange: (v: unknown) => void
  onBlur?: () => void
  disabled: boolean
  /** The form follows the interface language: the logo uploader's chrome does too (FileUploader's `translated`). */
  translated?: boolean
}) {
  switch (field.inputType) {
    case 'text':
    case 'tel':
    case 'email':
      return (
        <TextLikeField
          field={field}
          inputType={field.inputType}
          value={(value as string | undefined) ?? ''}
          error={error}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
        />
      )
    case 'textarea':
      return (
        <TextareaField
          field={field}
          value={(value as string | undefined) ?? ''}
          error={error}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
        />
      )
    case 'radio':
      return (
        <RadioField
          field={field}
          value={(value as string | null | undefined) ?? null}
          error={error}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'file':
      return (
        <FileField
          field={field}
          value={(value as number | null | undefined) ?? null}
          error={error}
          onChange={onChange}
          disabled={disabled}
          translated={translated}
        />
      )
  }
}

function TextLikeField({
  field,
  inputType,
  value,
  error,
  onChange,
  onBlur,
  disabled,
}: {
  field: FieldDescriptor
  inputType: 'text' | 'tel' | 'email'
  value: string
  error?: string
  onChange: (v: string) => void
  onBlur?: () => void
  disabled: boolean
}) {
  return (
    <div>
      <Input
        lbl={field.label}
        type={inputType}
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={field.placeholder}
        error={error}
        required={false}
        disabled={disabled}
      />
      {field.helpText && !error && <p className='mt-1 ms-1 text-xs text-gray-500'>{field.helpText}</p>}
    </div>
  )
}

function TextareaField({
  field,
  value,
  error,
  onChange,
  onBlur,
  disabled,
}: {
  field: FieldDescriptor
  value: string
  error?: string
  onChange: (v: string) => void
  onBlur?: () => void
  disabled: boolean
}) {
  return (
    <div>
      <Input
        lbl={field.label}
        as='textarea'
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={field.placeholder}
        error={error}
        required={false}
        disabled={disabled}
      />
      {field.helpText && !error && <p className='mt-1 ms-1 text-xs text-gray-500'>{field.helpText}</p>}
    </div>
  )
}

function RadioField({
  field,
  value,
  error,
  onChange,
  disabled,
}: {
  field: FieldDescriptor
  value: string | null
  error?: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const options = field.options ?? []
  return (
    <div>
      <p className='mb-2 ms-1 text-sm text-gray-600'>{field.label}</p>
      <div className='grid gap-2'>
        {options.map((opt) => {
          const isSelected = value === opt.value
          return (
            <label
              key={opt.value}
              className={
                'flex items-start gap-3 px-3 py-2.5 rounded-md border cursor-pointer transition-colors ' +
                (isSelected
                  ? 'border-solid bg-softy/50'
                  : 'border-gray-200 hover:border-gray-300') +
                (disabled ? ' opacity-50 pointer-events-none' : '')
              }
            >
              <input
                type='radio'
                name={`issuer-radio-${field.key}`}
                value={opt.value}
                checked={isSelected}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className='mt-1'
              />
              <div className='min-w-0 flex-1'>
                <p className='font-medium text-gray-900'>{opt.label}</p>
                <p className='text-sm text-gray-500'>{opt.description}</p>
              </div>
            </label>
          )
        })}
      </div>
      {field.helpText && !error && <p className='mt-1 ms-1 text-xs text-gray-500'>{field.helpText}</p>}
      {error && <p className='mt-1 ms-1 text-sm text-red-600'>{error}</p>}
    </div>
  )
}

function FileField({
  field,
  value,
  error,
  onChange,
  disabled,
  translated,
}: {
  field: FieldDescriptor
  value: number | null
  error?: string
  onChange: (v: number | null) => void
  disabled: boolean
  translated: boolean
}) {
  return (
    <div>
      <p className='mb-1 ms-1 text-sm text-gray-600'>{field.label}</p>
      <FileUploader
        name={field.key}
        single
        type='image'
        initialFiles={value as any}
        title={field.label}
        tooltipClass='h-20'
        disabled={disabled}
        translated={translated}
        onFilesChange={(files: any) => {
          const first = Array.isArray(files) ? files[0] : files
          onChange(first?.id ?? null)
        }}
      />
      {field.helpText && !error && <p className='mt-1 ms-1 text-xs text-gray-500'>{field.helpText}</p>}
      {error && <p className='mt-1 ms-1 text-sm text-red-600'>{error}</p>}
    </div>
  )
}
