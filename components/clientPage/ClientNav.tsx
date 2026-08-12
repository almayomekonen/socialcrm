'use client'

import { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function ClientNav({ id }) {
  const pathname = usePathname()

  const isActive = (href) => pathname.includes(href)

  const links = [
    { href: 'summary', title: 'סיכום ליד' },
    { href: 'tasks', title: 'משימות' },
    { href: 'files', title: 'קבצים' },
    { href: 'billing', title: 'חיוב' },
  ]

  return (
    /* `overflow-x-auto` + non-shrinking links: four tabs at px-8 need ~426px, so
       on a 360px phone they were being squashed and pushed out of reach. They now
       scroll instead. No-op on desktop, where the row has never overflowed. */
    <div className='flex gap-0 full-bleed border-b-4 overflow-x-auto'>
      {links.map((link) => (
        <NavLink key={link.href} href={link.href} title={link.title} />
      ))}
    </div>
  )

  function NavLink({ href, title }) {
    return (
      <Link
        href={`/clients/${id}/${href}` as Route}
        className={`shrink-0 whitespace-nowrap px-8 py-2 ${isActive(href) ? 'text-solid -mb-1 font-semibold border-b-4 border-solid' : ''}`}
      >
        {title}
      </Link>
    )
  }
}
