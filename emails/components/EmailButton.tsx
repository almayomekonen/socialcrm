import { Button } from '@react-email/components'
import { ReactNode } from 'react'

type Props = {
  href: string
  children: ReactNode
}

export function EmailButton({ href, children }: Props) {
  return (
    <Button
      href={href}
      className="rounded-lg bg-indigo-600 px-6 py-3 text-center text-sm font-semibold text-white no-underline"
    >
      {children}
    </Button>
  )
}
