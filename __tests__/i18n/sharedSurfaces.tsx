import type { Surface } from './surfaces'

/**
 * Leak-gate registrations for shared screens Phase E6 translated (desktop):
 * the (app) segment error boundary. Spread into SURFACES (surfaces.tsx).
 * The tour popovers, the Help menu and the "no leads" notice render into
 * <body> (Driver.js / portals), so they are scanned where they are opened:
 * educationLocales.test.tsx; the Pro toast and useAction's line in
 * sharedControlsLocales.test.tsx.
 */
export const SHARED_SURFACES: Surface[] = [
  {
    name: '(app) error boundary — the recovery screen',
    route: '(any workspace route that fails)',
    render: async (locale) => {
      const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
      const { default: AppError } = await import('@/app/(app)/error')
      return (
        <I18nProvider locale={locale}>
          <AppError error={new Error('gate')} reset={() => {}} />
        </I18nProvider>
      )
    },
    allowed: [],
  },
]
