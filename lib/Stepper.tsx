'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function Step({ title, href, ...props }) {
  const pathName = usePathname()
  const isActive = pathName === href
  return (
    <Link
      className={`mid-step ps-5 pe-4 py-1  text-white -me-[5px] first:start-step first:ps-3 last:end-step last:pe-3 rounded cursor-pointer ${
        isActive ? 'bg-solid-green' : 'bg-soft-green'
      }`}
      href={href}
      {...props}
    >
      {title}
    </Link>
  )
}
