'use client'

import { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

export default function ClientNav({ id }) {
  const t = useT()
  const region = useRegionAttrs()
  const pathname = usePathname()

  const isActive = (href) => pathname.includes(href)

  const links = [
    { href: 'summary', title: t('leadDetail.nav.summary') },
    { href: 'tasks', title: t('leadDetail.nav.tasks') },
    { href: 'files', title: t('leadDetail.nav.files') },
    { href: 'billing', title: t('leadDetail.nav.billing') },
  ]

  return (
    /* `overflow-x-auto` + non-shrinking links: four tabs at px-8 need ~426px, so
       on a 360px phone they were being squashed and pushed out of reach. They now
       scroll instead. No-op on desktop, where the row has never overflowed. */
    <div className='flex gap-0 full-bleed border-b-4 overflow-x-auto' {...region}>
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
