'use client'

import { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function ClientNav({ id }) {
  const pathname = usePathname()

  const isActive = (href) => pathname.includes(href)

  const links = [
    { href: 'summary', title: 'סיכום לקוח' },
    { href: 'tasks', title: 'משימות' },
    { href: 'files', title: 'קבצים' },
  ]

  return (
    <div className='flex gap-0 full-bleed border-b-4'>
      {links.map((link) => (
        <NavLink key={link.href} href={link.href} title={link.title} />
      ))}
    </div>
  )

  function NavLink({ href, title }) {
    return (
      <Link
        href={`/clients/${id}/${href}` as Route}
        className={`px-8 py-2 ${isActive(href) ? 'text-solid -mb-1 font-semibold border-b-4 border-solid' : ''}`}
      >
        {title}
      </Link>
    )
  }
}
