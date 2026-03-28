'use client'

import { useState, type ReactNode } from 'react'

const NAV_LINKS: { text: ReactNode; href: string }[] = [
  { text: 'ניהול לידים', href: '/crm' },
  { text: "פיצ'רים", href: '/features' },
  { text: 'פייסבוק', href: '/facebook-leads' },
  { text: 'וואטסאפ', href: '/whatsapp-leads' },
  { text: <span dir='ltr'>CRM vs אקסל</span>, href: '/crm-vs-excel' },
]

const AUTH_LINKS = [
  { type: 'link' as const, text: 'התחבר', href: '/auth' },
  { type: 'button-primary' as const, text: 'התחל בחינם', href: '/auth/register' },
]

const LOGO_TEXT = 'SocialCRM'

export function MarketingNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className='pt-6 pb-3 px-4'>
      <nav className='bg-white rounded-xl relative z-10 max-w-6xl mx-auto flex items-center justify-between py-4 px-8 lg:px-12 lg:py-4'>
        <div className='flex items-center space-x-2'>
          <span className='text-xl font-bold text-gray-800'>{LOGO_TEXT}</span>
        </div>

        <div className='flex items-center space-x-6 text-gray-600 text-sm'>
          <ul className='hidden lg:flex items-center space-x-6'>
            {NAV_LINKS.map((link, index) => (
              <li key={index}>
                <a href={link.href} className='hover:text-blue-600'>
                  {link.text}
                </a>
              </li>
            ))}
          </ul>

          <div className='hidden lg:flex items-center space-x-4'>
            {AUTH_LINKS.map((link, index) => {
              if (link.type === 'link') {
                return (
                  <a key={index} href={link.href} className='text-gray-600 hover:text-blue-600'>
                    {link.text}
                  </a>
                )
              }
              if (link.type === 'button-primary') {
                return (
                  <a key={index} href={link.href} className='px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold'>
                    {link.text}
                  </a>
                )
              }
              return null
            })}
          </div>
        </div>

        <button
          className='lg:hidden text-gray-600 hover:text-blue-600 focus:outline-none'
          onClick={() => setMobileOpen(true)}
          aria-label='פתח תפריט'
        >
          <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M4 6h16M4 12h16m-7 6h7' />
          </svg>
        </button>
      </nav>

      <div
        className={`fixed inset-0 z-40 bg-white transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full'
        } lg:hidden overflow-y-auto p-8`}
      >
        <div className='flex items-center justify-between mb-8'>
          <span className='text-xl font-bold text-gray-800'>{LOGO_TEXT}</span>
          <button
            className='text-gray-600 hover:text-blue-600 focus:outline-none'
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
            <a
              key={index}
              href={link.href}
              className='text-gray-800 text-lg font-medium hover:text-blue-600'
              onClick={() => setMobileOpen(false)}
            >
              {link.text}
            </a>
          ))}
        </div>

        <div className='flex flex-col space-y-4 mt-8 pt-6 border-t border-gray-200'>
          {AUTH_LINKS.map((link, index) => {
            if (link.type === 'link') {
              return (
                <a
                  key={index}
                  href={link.href}
                  className='text-gray-600 hover:text-blue-600 text-lg'
                  onClick={() => setMobileOpen(false)}
                >
                  {link.text}
                </a>
              )
            }
            if (link.type === 'button-primary') {
              return (
                <a
                  key={index}
                  href={link.href}
                  className='px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold text-lg'
                  onClick={() => setMobileOpen(false)}
                >
                  {link.text}
                </a>
              )
            }
            return null
          })}
        </div>
      </div>
    </div>
  )
}
