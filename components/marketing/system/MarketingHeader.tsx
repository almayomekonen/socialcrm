'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The site header — Lumen's "truncating navbar" ported.
 *
 * At rest it sits flush in the page. On scroll it detaches into a floating
 * rounded pill with a blurred ground, and loses a little height. That single
 * mechanic is most of why Lumen's chrome reads as considered, and it costs one
 * scroll listener.
 *
 * It lives in the LAYOUT, not in each page. Mounting a header per page is how
 * `/privacy`, `/terms` and `/data-deletion` ended up with no navigation at all
 * — three indexed pages that were dead ends for readers and for internal links.
 *
 * NO SERVER ACTION IMPORT. The previous navbar called `getSessionState()` on
 * mount, which pulled `@/actions/auth` → `config/db` into the module graph of
 * every marketing page: the public site could not be imported without a
 * DATABASE_URL. The header is static now; the CTA does not depend on session.
 *
 * RTL: laid out with flex and logical utilities only, so logo and actions swap
 * sides from `dir` alone with nothing to mirror.
 */

const LINKS = [
  { label: 'ניהול לידים', href: '/' },
  { label: 'יכולות', href: '/' },
  { label: 'וואטסאפ', href: '/channels' },
  { label: 'פייסבוק', href: '/channels' },
  { label: 'אינסטגרם', href: '/channels' },
  { label: 'מחירים', href: '/pricing' },
]

const CTA = { label: 'התחל בחינם', href: '/auth' }

function Logo() {
  return (
    <Link href='/' className='flex h-11 shrink-0 items-center gap-2.5 font-semibold text-mkt-fg'>
      <span
        aria-hidden='true'
        className='grid size-7 place-items-center rounded-mkt-md bg-mkt-ink text-[13px] font-bold text-white'
      >
        S
      </span>
      SocialCRM
    </Link>
  )
}

export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const openMenu = useCallback(() => {
    setMounted(true)
    requestAnimationFrame(() => setShown(true))
  }, [])

  const closeMenu = useCallback(() => {
    setShown(false)
    window.setTimeout(() => setMounted(false), 280)
  }, [])

  // Lock the page behind the sheet without losing scroll position.
  useEffect(() => {
    if (!mounted) return
    const y = window.scrollY
    const body = document.body
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width }
    body.style.position = 'fixed'
    body.style.top = `-${y}px`
    body.style.width = '100%'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      window.scrollTo(0, y)
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mounted, closeMenu])

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-all duration-300 ease-mkt motion-reduce:transition-none',
        scrolled ? 'px-3 pt-2' : 'px-0 pt-0',
      )}
    >
      <nav
        aria-label='ניווט ראשי'
        className={cn(
          'mx-auto flex w-full max-w-mkt-nav items-center justify-between gap-4 px-5 md:px-8 lg:px-10',
          'transition-all duration-300 ease-mkt motion-reduce:transition-none',
          scrolled
            ? 'h-14 rounded-full border border-mkt-border bg-mkt-bg/85 shadow-sm backdrop-blur-md'
            : 'h-16 border-b border-mkt-hairline bg-mkt-bg',
        )}
      >
        <Logo />

        <ul className='hidden items-center gap-1 lg:flex'>
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className='flex min-h-11 items-center rounded-mkt-md px-3 text-[0.9375rem] text-mkt-muted transition-colors hover:text-mkt-fg'
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className='flex items-center gap-1.5'>
          <Link
            href='/auth'
            className='hidden h-11 items-center rounded-mkt-md px-3 text-[0.9375rem] text-mkt-muted transition-colors hover:text-mkt-fg sm:inline-flex'
          >
            כניסה
          </Link>
          <Link
            href={CTA.href}
            className='mkt-sheen inline-flex h-11 items-center rounded-mkt-lg bg-mkt-ink px-4 text-[0.9375rem] font-semibold text-white ring-1 ring-white/12 transition-transform active:scale-[0.98] motion-reduce:transition-none'
          >
            {CTA.label}
          </Link>
          <button
            type='button'
            onClick={openMenu}
            aria-label='פתח תפריט'
            aria-expanded={mounted}
            className='grid size-11 place-items-center rounded-mkt-md text-mkt-fg lg:hidden'
          >
            <svg className='size-5' fill='none' stroke='currentColor' viewBox='0 0 24 24' aria-hidden='true'>
              <path strokeLinecap='round' strokeWidth='1.8' d='M4 7h16M4 12h16M4 17h16' />
            </svg>
          </button>
        </div>
      </nav>

      {/*
        The sheet is UNMOUNTED when closed, and that is load-bearing. Kept
        mounted as `fixed inset-0` and merely translated off-screen, it combined
        with this header's backdrop-filter to blank the ENTIRE page at mobile
        widths in Chromium — correct layout and computed styles, nothing
        painted. Verified: removing either the backdrop-filter or the overlay
        restored it. An off-screen fixed layer still composites; `display: none`
        does not.
      */}
      {mounted && (
        <div
          className={cn(
            'mkt-ground-dark fixed inset-0 z-100 flex flex-col gap-1 p-6 lg:hidden',
            'transition-transform duration-300 ease-mkt motion-reduce:transition-none',
            shown ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full',
          )}
        >
          <div className='mb-6 flex items-center justify-between'>
            <Logo />
            <button
              type='button'
              onClick={closeMenu}
              aria-label='סגור תפריט'
              className='grid size-11 place-items-center rounded-mkt-md text-mkt-fg'
            >
              <svg className='size-5' fill='none' stroke='currentColor' viewBox='0 0 24 24' aria-hidden='true'>
                <path strokeLinecap='round' strokeWidth='1.8' d='M6 18 18 6M6 6l12 12' />
              </svg>
            </button>
          </div>

          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={closeMenu}
              className='flex h-12 items-center rounded-mkt-md px-2 text-lg text-mkt-fg'
            >
              {l.label}
            </Link>
          ))}

          <Link
            href={CTA.href}
            onClick={closeMenu}
            className='mt-5 grid h-12 place-items-center rounded-mkt-lg bg-mkt-accent text-base font-semibold text-white'
          >
            {CTA.label}
          </Link>
        </div>
      )}
    </header>
  )
}
