'use client'
import { cva } from 'class-variance-authority'
import { twMerge } from 'tailwind-merge'
import React, { ButtonHTMLAttributes } from 'react'
import Link, { LinkProps, useLinkStatus } from 'next/link'
import { useFormStatus } from 'react-dom'
import Icon, { IconNames } from '../Icon'

const buttonVariants = cva('flex items-center min-w-fit justify-center font-medium rounded-md flex-nowrap', {
  variants: {
    variant: {
      solid: 'bg-solid text-white hover:bg-solid/85',
      soft: 'bg-gray-200 hover:bg-gray-300 text-black',
      outline: 'border text-black border-gray-200 bg-white hover:bg-gray-100/60',
      sign: 'hover:opacity-85',
      simple:
        'hover:bg-solid leading-tight active:opacity-95 hover:text-white block w-full text-start disabled:pointer-events-none disabled:opacity-50',
      destructive: 'bg-red-600 text-white hover:bg-red-700',
      ghost: 'bg-transparent text-black hover:bg-gray-100/60',
    },
    size: {
      small: 'h-9 px-3 gap-3 text-[15px]',
      medium: 'h-10 px-4 gap-3',
      large: 'h-11 px-5 gap-4 text-lg',
      icon: 'size-10 p-0',
      sign: 'size-4 p-0',
      simple: 'px-2 h-8 w-full ',
    },
  },
  defaultVariants: {
    variant: 'solid',
    size: 'medium',
  },
})

const iconVariants = cva('', {
  variants: {
    variant: {
      solid: 'bg-white',
      soft: 'bg-black',
      outline: 'bg-black',
      sign: 'bg-black',
      simple: 'bg-black',
      destructive: 'bg-black',
      ghost: 'bg-black',
    },
    size: {
      small: 'size-[15px]',
      medium: 'size-4',
      large: 'size-5',
      icon: 'size-4',
      sign: 'size-4',
      simple: 'size-4',
    },
  },
  defaultVariants: {
    size: 'medium',
    variant: 'solid',
  },
})

const variantToIconType: Record<string, 'reg' | 'sol' | 'lit'> = {
  solid: 'sol',
  soft: 'reg',
  outline: 'reg',
  sign: 'reg',
  simple: 'reg',
  destructive: 'reg',
  ghost: 'reg',
}

// Dev-only: dedupe the icon-only-without-name warning so it fires once per icon
// instead of on every render.
const warnedIconOnly = new Set<string>()

function warnIfIconOnlyHasNoName(
  icon: IconNames | undefined,
  lbl: string | undefined,
  as: 'submit' | undefined,
  rest: { 'aria-label'?: string; 'aria-labelledby'?: string; title?: string },
) {
  if (process.env.NODE_ENV === 'production') return
  // Icon-only = has an icon, renders no visible <span> text (submit always shows
  // text). Its accessible name must then come from aria-label/aria-labelledby/title.
  const isIconOnly = !!icon && !lbl && as !== 'submit'
  const hasName = !!rest['aria-label'] || !!rest['aria-labelledby'] || !!rest.title
  if (!isIconOnly || hasName) return
  const key = icon ?? 'unknown'
  if (warnedIconOnly.has(key)) return
  warnedIconOnly.add(key)
  console.warn(
    `[Btn] Icon-only button (icon="${icon}") has no accessible name. ` +
      'Add an `aria-label` (preferred) or `title` so screen-reader users know what it does.',
  )
}

export function Btn({
  className,
  variant,
  size,
  href,
  icon,
  lbl,
  iconClassName,
  flipIcon,
  as,
  iconType = 'sol',
  ...props
}: ButtonProps) {
  warnIfIconOnlyHasNoName(icon, lbl, as, props)

  const buttonClasses = twMerge(buttonVariants({ variant, size, className }))

  let iconClasses = twMerge(iconVariants({ variant, size, className: iconClassName }))
  const icnTYpe = variantToIconType[variant] || iconType

  if (as === 'submit') {
    const res = useFormStatus()
    const pending = res.pending
    const iconName = () => {
      if (pending) return 'spinner'
      return icon || 'floppy-disk'
    }

    if (pending) iconClasses += 'animate-spin'

    return (
      <button type='submit' className={buttonClasses} disabled={pending} {...props}>
        {<Icon name={iconName()} type={icnTYpe} className={iconClasses} flip={flipIcon} />}
        {<span>{lbl || 'שמירה'}</span>}
      </button>
    )
  }

  const content = (
    <>
      {icon && <Icon name={icon} type={icnTYpe} className={iconClasses} flip={flipIcon} />}
      {lbl && <span>{lbl}</span>}
    </>
  )

  if (href) {
    return (
      <Link href={href as any} className={buttonClasses} {...(props as unknown as Omit<LinkProps<'any'>, 'href'>)}>
        <LinkContent icon={icon} lbl={lbl} iconClasses={iconClasses} iconType={icnTYpe} flipIcon={flipIcon} />
      </Link>
    )
  }

  return (
    <button className={buttonClasses} {...props}>
      {content}
    </button>
  )
}

/**
 * Contents of an `href` Btn.
 *
 * Lives in its own component because `useLinkStatus` reports the pending state
 * of the *enclosing* <Link>, so it must be called from a descendant. While a
 * navigation is in flight the icon slot shows the same spinner every other
 * pending control in the product uses — local to this button, no overlay, no
 * new component. The label is never replaced, so the accessible name is
 * unchanged and the element stays a real <a href> (middle-click, open in new
 * tab and keyboard activation all behave as before).
 */
function LinkContent({
  icon,
  lbl,
  iconClasses,
  iconType,
  flipIcon,
}: {
  icon?: IconNames
  lbl?: string
  iconClasses: string
  iconType: 'reg' | 'sol' | 'lit'
  flipIcon?: boolean
}) {
  const { pending } = useLinkStatus()
  const iconName = pending ? 'spinner' : icon

  return (
    <>
      {iconName && (
        <Icon
          name={iconName}
          type={iconType}
          className={pending ? twMerge(iconClasses, 'animate-spin') : iconClasses}
          flip={flipIcon}
        />
      )}
      {lbl && <span>{lbl}</span>}
    </>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  Partial<LinkProps> & {
    as?: 'submit'
    href?: string
    icon?: IconNames
    lbl?: string
    iconClassName?: string
    flipIcon?: boolean
    variant?: 'solid' | 'soft' | 'outline' | 'sign' | 'simple' | 'destructive' | 'ghost'
    iconType?: 'reg' | 'sol'
    size?: 'small' | 'medium' | 'large' | 'icon' | 'sign' | 'simple'
  }
