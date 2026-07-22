'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { logout, getSessionState } from '@/actions/auth'
import { Btn } from '@/lib/btns/Btn'

const NAV_LINKS: { text: ReactNode; href: string }[] = [
  { text: 'ניהול לידים', href: '/crm' },
  { text: "פיצ'רים", href: '/features' },
  { text: 'פייסבוק', href: '/facebook-leads' },
  { text: 'וואטסאפ', href: '/whatsapp-leads' },
  { text: <span dir='ltr'>CRM vs אקסל</span>, href: '/crm-vs-excel' },
  { text: 'מחירים', href: '/pricing' },
]

const LOGO_TEXT = 'SocialCRM'

interface MarketingNavbarProps {
  isAuthenticated?: boolean
}

export function MarketingNavbar({ isAuthenticated = false }: MarketingNavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authed, setAuthed] = useState(isAuthenticated)

  useEffect(() => {
    let active = true
    getSessionState().then((ok) => active && setAuthed(ok))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const scrollY = window.scrollY
    const body = document.body
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      body.style.overflow = prev.overflow
      window.scrollTo(0, scrollY)
    }
  }, [mobileOpen])

  const cta = isAuthenticated
    ? { text: 'פתח את האפליקציה', href: '/' }
    : { text: 'התחל בחינם', href: '/auth' }

  return (
    <div className='pt-6 pb-3 px-4'>
      <nav aria-label='ניווט ראשי' className='bg-white rounded-xl relative z-10 max-w-6xl mx-auto flex items-center justify-between py-4 px-5 md:px-8 lg:px-12 lg:py-4'>
        <div className='flex items-center space-x-2'>
          <Link href='/' className='text-xl font-bold text-gray-800 hover:text-[#3f20f5]'>{LOGO_TEXT}</Link>
        </div>

        <div className='flex items-center space-x-6 text-gray-600 text-sm'>
          <ul className='hidden lg:flex items-center space-x-6'>
            {NAV_LINKS.map((link, index) => (
              <li key={index}>
                <Link href={link.href} className='hover:text-[#3f20f5]'>
                  {link.text}
                </Link>
              </li>
            ))}
          </ul>

          <div className='hidden lg:flex items-center space-x-4'>
            <Btn
              href={cta.href}
              lbl={cta.text}
              className='h-auto px-4 py-2 bg-[#3f20f5] text-white rounded-md hover:bg-[#3520cc] font-semibold'
            />
          </div>
        </div>

        <div className='lg:hidden flex items-center gap-3'>
          <Btn
            href={cta.href}
            lbl={cta.text}
            className='h-auto px-3 py-2 bg-[#3f20f5] text-white rounded-md hover:bg-[#3520cc] font-semibold text-sm'
          />
          <button
            className='text-gray-600 hover:text-[#3f20f5] focus:outline-none p-1'
            onClick={() => setMobileOpen(true)}
            aria-label='פתח תפריט'
          >
            <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M4 6h16M4 12h16m-7 6h7' />
            </svg>
          </button>
        </div>
      </nav>

      <div
        className={`fixed inset-0 z-40 bg-white transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full'
        } lg:hidden overflow-y-auto p-8`}
      >
        <div className='flex items-center justify-between mb-8'>
          <Link href='/' className='text-xl font-bold text-gray-800 hover:text-[#3f20f5]' onClick={() => setMobileOpen(false)}>{LOGO_TEXT}</Link>
          <button
            className='text-gray-600 hover:text-[#3f20f5] focus:outline-none'
            onClick={() => setMobileOpen(false)}
            aria-label='סגור תפריט'
          >
            <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M6 18L18 6M6 6l12 12' />
            </svg>
          </button>
        </div>

        <div className='flex flex-col space-y-4 mt-8'>
          {NAV_LINKS.map((link, index) => (
            <Link
              key={index}
              href={link.href}
              className='text-gray-800 text-lg font-medium hover:text-[#3f20f5]'
              onClick={() => setMobileOpen(false)}
            >
              {link.text}
            </Link>
          ))}
        </div>

        <div className='flex flex-col space-y-4 mt-8 pt-6 border-t border-gray-200'>
          <Btn
            href={cta.href}
            lbl={cta.text}
            className='h-auto px-4 py-3 bg-[#3f20f5] text-white rounded-md hover:bg-[#3520cc] font-semibold text-lg'
            onClick={() => setMobileOpen(false)}
          />
          {authed && (
            <form action={logout}>
              <button
                type='submit'
                className='w-full py-2 text-center text-gray-600 text-base font-medium hover:text-[#3f20f5]'
              >
                התנתק
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
