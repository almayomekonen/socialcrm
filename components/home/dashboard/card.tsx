import * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui v4 Card (Card, CardHeader, CardTitle, CardDescription, CardAction,
// CardContent, CardFooter) for the /dashboard surface, on the app's tokens.
//
// Kept separate from components/ui/card.tsx on purpose: that older v3 card is
// used by the marketing orbital timeline, which depends on its p-6 header/content
// padding. Changing it would restyle the marketing site; this file only affects
// the dashboard. CardAction sits at the header's end side, which follows the page
// direction (left in Hebrew, right in English).


function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card'
      className={cn('flex min-w-0 flex-col gap-6 rounded-xl border border-border bg-surface py-6 text-ink shadow-xs', className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-header'
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot='card-title' className={cn('leading-none font-semibold text-ink', className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='card-description' className={cn('text-sm text-gray-500', className)} {...props} />
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-action'
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='card-content' className={cn('px-6', className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='card-footer' className={cn('flex items-center px-6 [.border-t]:pt-6', className)} {...props} />
}

export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter }
