'use client'

import { cva, VariantProps } from 'class-variance-authority'
import Link from 'next/link'
import React, { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'
import { toInputDate } from '../dates'

const formFieldVariants = cva(
  'h-10 w-full rounded-md border border-gray-200 bg-white focus:outline-2 focus:outline-offset-0 disabled:opacity-50',
  {
    variants: {
      hasError: {
        true: 'border-red-500 focus:outline-red-200',
        false: 'border-gray-200 focus:outline-primary',
      },
    },
    defaultVariants: {
      hasError: false,
    },
  },
)

interface FormFieldProps {
  children: React.ReactNode
  lbl?: string
  info?: string
  href?: string
  className?: string
  error?: string
  tooltip?: React.ReactNode
  // Placement for the [data-tip] hover tooltip. Default (undefined/'top') keeps
  // the existing upward CSS behavior; 'bottom' opts into the downward variant
  // (data-tip-pos='bottom') for controls anchored near the top of the page whose
  // upward tooltip would be clipped by the main/workspace-grid overflow.
  tooltipPos?: 'top' | 'bottom'
  // When provided, the visible label renders as a real <label htmlFor> so it is
  // programmatically tied to the control. Omitted by direct consumers that pass
  // non-input children → falls back to a plain <p> (unchanged behavior).
  htmlFor?: string
  // id of the error message, so the control can reference it via aria-describedby.
  errorId?: string
}

export function FormField({ children, lbl, info, href, className, error, tooltip, tooltipPos, htmlFor, errorId }: FormFieldProps) {
  // Only emit the attribute for the opt-in downward variant; 'top'/undefined
  // render no attribute so every existing consumer is byte-for-byte unchanged.
  const tipPos = tooltipPos === 'bottom' ? 'bottom' : undefined
  return (
    <div className={twMerge('block ', className)}>
      {lbl && (
        <div className='flex justify-between mb-1 ms-1 items-end '>
          {htmlFor ? (
            <label htmlFor={htmlFor} data-tip={tooltip} data-tip-pos={tipPos} className='text-gray-600 text-sm font-medium '>
              {lbl}
            </label>
          ) : (
            <p data-tip={tooltip} data-tip-pos={tipPos} className='text-gray-600 text-sm font-medium '>
              {lbl}
            </p>
          )}
          {info && !href && <p className='text-gray-600 text-sm'>{info}</p>}
          {href && (
            <Link href={href as any} className='text-blue-700 text-sm underline' target='_blank' rel='noreferrer'>
              {info}
            </Link>
          )}
        </div>
      )}
      {children}
      {error && (
        <p id={errorId} role='alert' className='text-red-600 text-sm mt-1 ms-1'>
          {error}
        </p>
      )}
    </div>
  )
}

interface InputProps
  extends Omit<ComponentProps<'input'> & ComponentProps<'textarea'>, 'as'>, VariantProps<typeof formFieldVariants> {
  as?: 'input' | 'textarea' | 'resizeTextarea'
  lbl?: string
  info?: string
  href?: string
  error?: string
  tooltip?: React.ReactNode
  tooltipPos?: 'top' | 'bottom'
  defaultValue?: any
}

export function Input({
  as = 'input',
  lbl,
  info,
  href,
  error,
  className,
  required = true,
  tooltip,
  tooltipPos,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const isResize = as === 'resizeTextarea'
  const Component = isResize || as === 'textarea' ? 'textarea' : 'input'

  // Stable id so the visible label can target this control via htmlFor. Respect
  // a caller-supplied id when present.
  const reactId = React.useId()
  const fieldId = id ?? reactId
  const errorId = error ? `${fieldId}-error` : undefined
  // Merge caller's aria-describedby with our error id (don't clobber it).
  const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(' ') || undefined

  const fieldClasses = twMerge(
    formFieldVariants({ hasError: !!error }),
    Component === 'textarea' ? 'min-h-24 p-2.5' : 'px-2.5',
    isResize ? 'resize-none scrollbar-hidden max-h-50' : '',
    className,
  )

  const handleAutoResize = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement
    target.style.height = 'auto'
    target.style.height = `${target.scrollHeight}px`
  }

  if (props.type === 'date' && props.defaultValue !== undefined && props.value === undefined) {
    props.defaultValue = toInputDate(props.defaultValue)
  }

  return (
    <FormField lbl={lbl} info={info} href={href} error={error} tooltip={tooltip} tooltipPos={tooltipPos} htmlFor={fieldId} errorId={errorId}>
      <Component
        id={fieldId}
        className={fieldClasses}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={describedBy}
        onInput={(e: any) => {
          if (isResize) handleAutoResize(e)
          props.onInput?.(e)
        }}
        required={required}
        {...props}
      />
    </FormField>
  )
}

const selectableBoxClasses =
  'has-[:checked]:bg-solid/5 grid grid-cols-[16px_1fr] items-center gap-4 min-h-10 cursor-pointer bg-white px-4 py-2 rounded-md border border-gray-200 w-auto'

interface CheckboxProps extends ComponentProps<'input'> {
  lbl: string
}

export function Checkbox({ lbl, className, ...props }: CheckboxProps) {
  return (
    <label className={twMerge(selectableBoxClasses, className)}>
      <input type='checkbox' {...props} className='size-4 accent-solid' />
      <p>{lbl}</p>
    </label>
  )
}

// 5. Refactored RadioGroup using the shared styles
interface RadioOption {
  value: string
  lbl: string
}
interface RadioGroupProps extends ComponentProps<'input'> {
  name: string
  options: RadioOption[]
}

export function RadioGroup({ name, options, className, ...props }: RadioGroupProps) {
  return (
    <>
      {options.map((option) => (
        <label key={option.value} className={twMerge(selectableBoxClasses, className)}>
          <input type='radio' name={name} value={option.value} className='accent-solid' {...props} />
          <p>{option.lbl}</p>
        </label>
      ))}
    </>
  )
}
type RadioProps = {
  name: string
  options: string[]
} & React.InputHTMLAttributes<HTMLInputElement>

export function RadioBtns({ name, options, defaultValue, placeholder, ...props }: RadioProps) {
  return (
    <>
      {placeholder && (
        <label className='has-checked:bg-solid/5 flex flex-nowrap items-center gap-4 h-10 cursor-pointer bg-white px-4 py-2 rounded-md border border-gray-200 w-auto'>
          <input type='radio' name={name} value='' className='accent-solid' defaultChecked={true} />
          <p>{placeholder}</p>
        </label>
      )}
      {options.map((opt) => (
        <label
          className='has-checked:bg-solid/5 flex flex-nowrap items-center gap-4 h-10 cursor-pointer bg-white px-4 py-2 rounded-md border border-gray-200 w-auto'
          key={opt}
        >
          <input type='radio' name={name} value={opt} className='accent-solid' defaultChecked={defaultValue === opt} {...props} />
          <p>{opt}</p>
        </label>
      ))}
    </>
  )
}

// 6. Consolidated and smarter Select component
type SelectOption = string | { [key: string]: any }
type SelectOptionGroup = { head: string; grp: SelectOption[] }

interface SelectProps extends ComponentProps<'select'>, VariantProps<typeof formFieldVariants> {
  lbl?: string
  info?: string
  href?: string
  error?: string
  placeholder?: string
  options: (SelectOption | SelectOptionGroup)[]
  val?: string // Key for option value if options are objects
  show?: string // Key for option label if options are objects
  returnJson?: boolean
}

export function Select({
  lbl,
  info,
  href,
  error,
  placeholder,
  options = [],
  val = 'id',
  show = 'name',
  className,
  returnJson = false,
  required = true,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: SelectProps) {
  // Stable id so the visible label targets this control via htmlFor.
  const reactId = React.useId()
  const fieldId = id ?? reactId
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(' ') || undefined

  const renderOption = (option: SelectOption, index: number) => {
    if (typeof option === 'string') {
      return (
        <option key={index} value={option}>
          {option}
        </option>
      )
    }
    return (
      <option key={index} value={returnJson ? JSON.stringify(option) : option[val]}>
        {option[show]}
      </option>
    )
  }

  return (
    <FormField lbl={lbl} info={info} href={href} error={error} htmlFor={fieldId} errorId={errorId}>
      <select
        id={fieldId}
        required={required}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={describedBy}
        className={twMerge(formFieldVariants({ hasError: !!error }), 'pe-8 ps-2', className)}
        {...props}
      >
        {placeholder && <option value=''>{placeholder}</option>}
        {options.map((item, index) => {
          // Check if it's an option group
          if (typeof item === 'object' && 'head' in item && 'grp' in item) {
            const group = item as SelectOptionGroup
            return (
              <optgroup label={group.head} key={group.head}>
                {group.grp.map(renderOption)}
              </optgroup>
            )
          }
          return renderOption(item, index)
        })}
      </select>
    </FormField>
  )
}

type SwitchProps = {
  lbl?: string
  className?: string
} & React.InputHTMLAttributes<HTMLInputElement>
export function Switch({ lbl, className = '', ...props }: SwitchProps) {
  className = twMerge('switch', className)

  return (
    <label className='flex gap-2 cursor-pointer'>
      <input className={className} type='checkbox' {...props} />
      {lbl && <p>{lbl}</p>}
    </label>
  )
}

type InputSidesProps = {
  lblRight?: string
  lblLeft?: string
  ref?: React.Ref<HTMLInputElement>
  inputCls?: string
} & React.InputHTMLAttributes<HTMLInputElement>

export function InputSides({ lblRight, lblLeft, className = '', ref, inputCls, ...props }: InputSidesProps) {
  return (
    <label className={twMerge('flex gap-2 flex-nowrap', className)}>
      {lblRight && <p className='text-gray-600 text-sm'>{lblRight}</p>}
      <input
        className={twMerge('h-10 w-28 rounded-md border border-gray-200 bg-white px-2.5 focus:outline-2 focus:outline-offset-0 focus:outline-primary', inputCls)}
        required
        ref={ref}
        {...props}
      />
      {lblLeft && <p className='text-gray-600 text-sm'>{lblLeft}</p>}
    </label>
  )
}
