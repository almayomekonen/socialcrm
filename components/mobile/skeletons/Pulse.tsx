'use client'

import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs } from '@/lib/i18n/config'

export function Pulse({ className }: { className: string }) {
  return <div className={`bg-gray-100 motion-safe:animate-pulse ${className}`} />
}

export function Status({ children }: { children: string }) {
  return (
    <span className='sr-only' role='status'>
      {children}
    </span>
  )
}

/**
 * The shell-level skeletons' screen-reader line, "טוען…" (`inbox.page.loading`,
 * the same sentence), in the interface language (i18n Phase F1). It declares
 * its own `lang`/`dir`: a skeleton renders inside the shell's Hebrew-declared
 * `<main>`. Outside the provider (the cold-boot `MobileChromeSkeleton`, before
 * the layout knows the user) it is Hebrew. Hebrew: exactly `Status`'s markup.
 */
export function LoadingStatus() {
  const t = useT()
  return (
    <span className='sr-only' role='status' {...regionAttrs(t.locale)}>
      {t('inbox.page.loading')}
    </span>
  )
}
