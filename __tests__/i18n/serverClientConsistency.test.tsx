// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { flatten } from '@/lib/i18n/coverage'
import { CATALOGS } from '@/lib/i18n/messages'
import { I18nProvider, useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import { UI_LOCALES } from '@/lib/i18n/config'

const prefs = { userLocale: null as string | null }
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: prefs.userLocale, agencyLocale: null }) }))

const { getServerT } = await import('@/lib/i18n/server')

const KEYS = [...flatten(CATALOGS.he).entries()]
// Every plural form a locale distinguishes is exercised at least once.
const COUNTS = [0, 1, 2, 3, 11, 100]
const PARAMS = { language: 'English', from: 'עברית', to: 'العربية' }

function renderAll(translate: (key: MessageKey, params?: Record<string, string | number>) => string) {
  const out: Record<string, string> = {}
  for (const [key, leaf] of KEYS) {
    if (typeof leaf === 'string') out[key] = translate(key as MessageKey, PARAMS)
    else for (const count of COUNTS) out[`${key}#${count}`] = translate(key as MessageKey, { ...PARAMS, count })
  }
  return out
}

function Probe() {
  const t = useT()
  return <pre data-testid='probe'>{JSON.stringify(renderAll(t))}</pre>
}

const saved = { ...process.env }
afterEach(() => {
  cleanup()
  process.env = { ...saved }
})

describe('server and client translate every key identically', () => {
  for (const locale of UI_LOCALES) {
    test(locale, async () => {
      process.env.UI_LOCALE_ENABLED = '1'
      process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
      prefs.userLocale = locale
      const server = renderAll(await getServerT({ id: 1, agencyId: 103 }))
      const { getByTestId } = render(
        <I18nProvider locale={locale}>
          <Probe />
        </I18nProvider>,
      )
      const client = JSON.parse(getByTestId('probe').textContent!)
      expect(client).toEqual(server)
      expect(Object.values(server).every((v) => v && !Object.keys(server).includes(v)), 'no key fell through').toBe(true)
    })
  }

  test('outside the rollout the server uses Hebrew — the same as a client with no provider', async () => {
    delete process.env.UI_LOCALE_ENABLED
    prefs.userLocale = 'en'
    const server = renderAll(await getServerT({ id: 1, agencyId: 103 }))
    const { getByTestId } = render(<Probe />)
    expect(JSON.parse(getByTestId('probe').textContent!)).toEqual(server)
    expect(server['shell.nav.leads']).toBe('לידים')
  })
})
