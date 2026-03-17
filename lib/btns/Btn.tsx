'use client'
import { cva } from 'class-variance-authority'
import { twMerge } from 'tailwind-merge'
import React, { ButtonHTMLAttributes } from 'react'
import Link, { LinkProps } from 'next/link'
import { useFormStatus } from 'react-dom'
import Icon, { IconNames } from '../Icon'

const buttonVariants = cva('flex min-w-fit justify-center font-semibold rounded-md flex-nowrap', {
  variants: {
    variant: {
      solid: 'bg-solid text-white hover:bg-solid/85',
      soft: 'bg-gray-200 hover:bg-gray-300 text-black',
      outline: 'border text-black border-gray-300 bg-white hover:bg-gray-100/60',
      sign: 'hover:opacity-85',
      simple:
        'hover:bg-solid leading-tight active:opacity-95 hover:text-white block w-full text-start disabled:pointer-events-none disabled:opacity-50',
      destructive: 'bg-red-50 text-white hover:bg-red-100',
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
        {content}
      </Link>
    )
  }

  return (
    <button className={buttonClasses} {...props}>
      {content}
    </button>
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
