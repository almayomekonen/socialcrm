// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { findHebrewLeaks } from './leakScan'
import { alignment, iconPicker, readyMessageChevrons } from './auditFixesSurfaces'

/**
 * The final UI audit fixes in en / ar (Hebrew identity: auditFixesHebrewBaseline,
 * rendered with no provider and under a Hebrew provider).
 */

vi.mock('next/dynamic', async () => ({ default: (await import('./auditFixesSurfaces')).auditDynamicMock }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/actions/files', () => ({ getUserImgs: async () => [], addFiles: async () => [], getPresigned: async () => [], addFilesToTask: async () => {} }))
vi.mock('@/actions/promos', () => ({ upsertPromo: async () => {} }))
vi.mock('@/actions/whatsapp/templates/archiveTemplate', () => ({ archiveTemplate: async () => ({ ok: true }) }))
vi.mock('@/actions/whatsapp/templates/discardTemplate', () => ({ discardTemplate: async () => ({ ok: true }) }))
vi.mock('@/actions/whatsapp/templates/retryTemplate', () => ({ retryTemplate: async () => ({ ok: true }) }))
vi.mock('@/actions/whatsapp/templates/createTemplate', () => ({ createTemplate: async () => ({ ok: true }) }))
vi.mock('@/modules/inbox/client/useAdaptivePoll', () => ({ useAdaptivePoll: () => {} }))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(Math, 'random').mockImplementation(() => 0.5)
})
afterAll(() => vi.restoreAllMocks())

/** A <template> parses table parts (a lone <thead>) that a <div> would drop. */
const parse = (html: string) => {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const box = document.createElement('div')
  box.append(tpl.content)
  return box
}
const HEBREW = /[֐-׿]/

describe('A: the questionnaire icon chooser opens the emoji picker in the interface language', () => {
  const WORDS = {
    en: ['Choose an emoji', 'Search emoji', 'Loading emoji…'],
    ar: ['اختيار رمز تعبيري', 'البحث عن رمز تعبيري', 'جارٍ تحميل الرموز التعبيرية…'],
  }
  for (const locale of ['en', 'ar'] as const) {
    test(locale, async () => {
      const panel = parse(await iconPicker(locale)).firstElementChild!
      const [dialog, search, loading] = WORDS[locale]
      expect(panel.getAttribute('aria-label')).toBe(dialog)
      expect(panel.querySelector('[data-stub]')!.getAttribute('data-search')).toBe(search)
      expect(panel.textContent).toBe(loading)
      expect(findHebrewLeaks(panel, [])).toEqual([])
      expect(HEBREW.test(panel.outerHTML)).toBe(false)
    })
  }
})

describe('C: the phone ready-messages rows mirror their chevron in LTR', () => {
  test('en mirrored; he / ar / no provider unchanged', async () => {
    const none = await readyMessageChevrons(null)
    expect(none).toHaveLength(2)
    expect(none.every((c) => !c.includes('-scale-x-100'))).toBe(true)
    expect(await readyMessageChevrons('he')).toEqual(none)
    expect(await readyMessageChevrons('ar')).toEqual(none)
    const en = await readyMessageChevrons('en')
    expect(en.every((c) => c.includes('-scale-x-100'))).toBe(true)
    expect(en.map((c) => c.replace(' -scale-x-100', ' '))).toEqual(none)
  })
})

describe('D: header rows and option buttons start at the reading edge outside Hebrew', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(locale, async () => {
      const he = await alignment(null)
      const out = await alignment(locale)
      for (const key of ['billingHead', 'trendHead', 'resultsHead', 'kindOptions'] as const) {
        const el = parse(out[key])
        const aligned = key === 'billingHead' || key === 'trendHead' ? [el.querySelector('tr')!] : key === 'resultsHead' ? [...el.querySelectorAll('th')] : [...el.querySelectorAll('button')]
        expect(aligned.length, key).toBeGreaterThan(0)
        for (const a of aligned) {
          expect(a.className, key).toContain('text-start')
          expect(a.className, key).not.toContain('text-right')
        }
        // Hebrew keeps the physical right edge.
        expect(he[key], key).toContain('text-right')
        expect(he[key], key).not.toContain('text-start')
      }
    })
  }
})
