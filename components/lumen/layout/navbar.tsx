'use client'
import { Inbox, MessageCircle, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useState } from 'react'

import Logo from '@/components/lumen/layout/logo'
import { ThemeToggle } from '@/components/lumen/theme-toggle'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/lumen/ui/accordion'
import { Button } from '@/components/lumen/ui/button'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@/components/lumen/ui/navigation-menu'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/components/lumen/utils'
import { HE } from '@/lib/marketing/copy/he'
import type { NavCopy } from '@/lib/marketing/copy/types'

const PRODUCT_ICONS = [Inbox, MessageCircle, Sparkles]

function navLinksFrom(copy: NavCopy) {
  return [
    {
      label: copy.product.label,
      href: '#',
      subitems: copy.product.subitems.map((subitem, index) => ({ ...subitem, icon: PRODUCT_ICONS[index] })),
    },
    // One centralized destination. No subitems, so this renders through the same
    // plain-link branch as מחירים — no trigger, no chevron, no panel.
    ...copy.links.map((link) => ({ ...link, subitems: undefined })),
  ]
}

export const NAV_LINKS = navLinksFrom(HE.nav)

function actionButtonsFrom(copy: NavCopy) {
  return [
    { label: copy.login.label, href: copy.login.href, variant: 'ghost' as const },
    { label: copy.trial.label, href: copy.trial.href, variant: 'default' as const },
  ]
}

const Navbar = ({ initialBannerVisible = true, copy = HE.nav }: { initialBannerVisible?: boolean; copy?: NavCopy }) => {
  const navLinks = navLinksFrom(copy)
  const actionButtons = actionButtonsFrom(copy)
  const rtl = copy.dir === 'rtl'
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const { isAtLeast } = useMediaQuery()
  const pathname = usePathname()
  const [isBannerVisible, setIsBannerVisible] = useState(initialBannerVisible)
  const hideNavbar = ['/signin', '/signup', '/docs', '/not-found', '/forgot-password'].some((route) => pathname.includes(route))

  useEffect(() => {
    const handleBannerDismiss = () => {
      setIsBannerVisible(false)
    }

    window.addEventListener('banner-dismissed', handleBannerDismiss)
    return () => window.removeEventListener('banner-dismissed', handleBannerDismiss)
  }, [])

  useEffect(() => {
    if (isMenuOpen) {
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
    } else {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }

    return () => {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
  }, [isMenuOpen])

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY
      setIsScrolled(scrollTop > 0)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  if (hideNavbar) return null

  return (
    <header
      className={cn(
        'isolate z-50 transition-all duration-300 ease-in-out',
        isScrolled && isAtLeast('lg') ? 'fixed top-0 right-0 left-0 translate-y-2 px-5.5' : 'relative',
      )}
    >
      <div
        className={cn(
          // `flex-row-reverse`: in RTL the first child lands on the right, which put
          // the logo there and the links on the left. Reversing the row restores
          // the intended arrangement — mark and wordmark on the inline-start edge,
          // navigation and actions on the inline-end edge — without reordering the
          // DOM, so tab order still follows the logo first.
          'bg-background navbar-container relative z-50 flex h-[var(--header-height)]',
          rtl && 'flex-row-reverse',
          'items-center justify-between gap-4 transition-all duration-300 ease-in-out',
          isScrolled &&
            isAtLeast('lg') &&
            'h-[calc(var(--header-height)-20px)] max-w-7xl rounded-full shadow-sm backdrop-blur-md',
        )}
      >
        <Logo href={copy.logoHref} markFirst={!rtl} className='[&_span]:font-bold' />

        {/* `flex-row-reverse`: puts the action group (the trial CTA / כניסה /
            theme toggle) at the inline-start edge of this group — the right,
            in RTL — so it is read first, with the navigation links after it.
            DOM order is unchanged, so tab order still reaches the links first. */}
        <div className={rtl ? 'flex flex-row-reverse items-center gap-8' : 'flex items-center gap-8'}>
          <NavigationMenu dir={copy.dir} viewport={false} className='hidden lg:block'>
            <NavigationMenuList className=''>
              {navLinks.map((item) => (
                <NavigationMenuItem key={item.label}>
                  {item.subitems ? (
                    <>
                      <NavigationMenuTrigger
                        className={cn(
                          'cursor-pointer [&_svg]:ms-2 [&_svg]:size-4',
                          // "after:from-chart-2 after:to-chart-3 after:absolute after:-inset-0.25 after:-z-1 after:rounded-sm after:bg-gradient-to-tr after:opacity-0 after:transition-all after:content-[''] hover:after:opacity-100",
                          pathname.startsWith(item.href) && 'bg-accent font-semibold',
                        )}
                        suppressHydrationWarning
                        // Radix closes this menu on CLICK and then suppresses
                        // hover-reopen until the pointer leaves and returns, so
                        // a click leaves it stuck shut under the cursor. The
                        // menu is desktop-only (`hidden lg:block`) and opens on
                        // hover, so the click-to-close buys nothing. Radix
                        // composes handlers and skips its own when the event is
                        // already default-prevented; keyboard open/close still
                        // works, since that path is onKeyDown.
                        onClick={(e) => e.preventDefault()}
                      >
                        {item.label}
                      </NavigationMenuTrigger>
                      <NavigationMenuContent className=''>
                        <ul className='grid w-[263px] gap-2'>
                          {item.subitems.map((subitem) => (
                            <li key={subitem.label}>
                              <NavigationMenuLink asChild className='hover:bg-accent/50 flex-row gap-3 p-3'>
                                <Link href={subitem.href}>
                                  <subitem.icon className='text-foreground size-5.5' />
                                  <div className='flex flex-col gap-1'>
                                    <div className='text-sm font-medium tracking-normal'>{subitem.label}</div>
                                    <div className='text-muted-foreground text-xs leading-snug'>{subitem.description}</div>
                                  </div>
                                </Link>
                              </NavigationMenuLink>
                            </li>
                          ))}
                        </ul>
                      </NavigationMenuContent>
                    </>
                  ) : (
                    <NavigationMenuLink
                      asChild
                      className={cn(
                        navigationMenuTriggerStyle(),
                        // "after:from-chart-2 after:to-chart-3 after:absolute after:-inset-0.25 after:-z-1 after:rounded-sm after:bg-gradient-to-tr after:opacity-0 after:transition-all after:content-[''] hover:after:opacity-100",
                        pathname === item.href && 'bg-accent font-semibold',
                      )}
                      suppressHydrationWarning
                    >
                      <Link href={item.href}>{item.label}</Link>
                    </NavigationMenuLink>
                  )}
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>

          {/* `flex-row-reverse`: RTL puts the first child on the right, which read
              sun → כניסה → the trial CTA. Reversing the row gives the intended
              reading order — the trial CTA, then כניסה, then the theme toggle —
              without reordering the DOM, so tab order is unchanged. */}
          <div className={rtl ? 'hidden flex-row-reverse items-center justify-end gap-4 lg:flex' : 'hidden items-center justify-end gap-4 lg:flex'}>
            <ThemeToggle />
            {actionButtons.map((button) => (
              <Button key={button.label} size='sm' variant={button.variant} className='rounded-full shadow-none' asChild>
                <Link href={button.href}>{button.label}</Link>
              </Button>
            ))}
          </div>
          <div className='flex items-center gap-2 lg:hidden lg:gap-4'>
            <ThemeToggle />
            <button
              className='text-muted-foreground relative flex size-8 rounded-sm border lg:hidden'
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              <span className='sr-only'>Open main menu</span>
              <div className={cn('absolute top-1/2 left-1/2 block w-4 -translate-x-1/2 -translate-y-1/2')}>
                <span
                  aria-hidden='true'
                  className={cn(
                    'absolute block h-0.25 w-full rounded-full bg-current transition duration-500 ease-in-out',
                    isMenuOpen ? 'rotate-45' : '-translate-y-1.5',
                  )}
                ></span>
                <span
                  aria-hidden='true'
                  className={cn(
                    'absolute block h-0.25 w-full rounded-full bg-current transition duration-500 ease-in-out',
                    isMenuOpen ? 'opacity-0' : '',
                  )}
                ></span>
                <span
                  aria-hidden='true'
                  className={cn(
                    'absolute block h-0.25 w-full rounded-full bg-current transition duration-500 ease-in-out',
                    isMenuOpen ? '-rotate-45' : 'translate-y-1.5',
                  )}
                ></span>
              </div>
            </button>
          </div>
        </div>
        {/*  Mobile Menu Navigation */}
        <div
          className={cn(
            'bg-background/95 text-accent-foreground fixed inset-0 -z-10 flex flex-col justify-between tracking-normal backdrop-blur-md transition-all duration-500 ease-out lg:hidden',
            isBannerVisible ? 'pt-[calc(var(--header-height)+3rem)]' : 'pt-[var(--header-height)]',
            isMenuOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0',
          )}
        >
          <div className='container'>
            <NavigationMenu orientation='vertical' className='inline-block w-full max-w-none py-10'>
              <NavigationMenuList className='w-full flex-col items-start gap-0'>
                {navLinks.map((item) => (
                  <NavigationMenuItem key={item.label} className='w-full py-2'>
                    {item.subitems ? (
                      <Accordion type='single' collapsible className=''>
                        <AccordionItem value={item.label}>
                          <AccordionTrigger className='flex w-full cursor-pointer items-center justify-between px-2 py-3 text-base font-normal hover:no-underline'>
                            {item.label}
                          </AccordionTrigger>
                          <AccordionContent className='pb-0'>
                            <div className='space-y-2'>
                              {item.subitems.map((subitem) => (
                                <NavigationMenuLink
                                  asChild
                                  key={subitem.label}
                                  className={cn(
                                    'text-muted-foreground hover:bg-accent/50 flex flex-row gap-2 p-3 font-medium transition-colors',
                                    pathname === subitem.href && 'bg-accent font-semibold',
                                  )}
                                  suppressHydrationWarning
                                >
                                  <Link href={subitem.href} onClick={() => setIsMenuOpen(false)}>
                                    <subitem.icon className='size-5' />
                                    <span className=''>{subitem.label}</span>
                                  </Link>
                                </NavigationMenuLink>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    ) : (
                      <NavigationMenuLink
                        asChild
                        className={cn(
                          'hover:text-foreground text-base transition-colors',
                          pathname === item.href && 'font-semibold',
                        )}
                        suppressHydrationWarning
                      >
                        <Link href={item.href} onClick={() => setIsMenuOpen(false)}>
                          {item.label}
                        </Link>
                      </NavigationMenuLink>
                    )}
                  </NavigationMenuItem>
                ))}
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          <div className='flex flex-col gap-4.5 border-t px-6 py-4'>
            {actionButtons.map((button) => (
              <Button
                key={button.label}
                variant={button.variant === 'ghost' ? 'outline' : button.variant}
                asChild
                className='h-12 flex-1 rounded-sm shadow-sm'
              >
                <Link href={button.href} onClick={() => setIsMenuOpen(false)}>
                  {button.label}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </header>
  )
}

export default Navbar
