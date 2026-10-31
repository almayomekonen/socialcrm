// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { findHebrewLeaks } from './leakScan'
import { iconPicker } from './auditFixesSurfaces'

/**
 * The final UI audit fixes in en / ar (Hebrew identity: auditFixesHebrewBaseline,
 * rendered with no provider and under a Hebrew provider).
 */

vi.mock('next/dynamic', async () => ({ default: (await import('./auditFixesSurfaces')).auditDynamicMock }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/actions/files', () => ({ getUserImgs: async () => [], addFiles: async () => [], getPresigned: async () => [], addFilesToTask: async () => {} }))
vi.mock('@/actions/promos', () => ({ upsertPromo: async () => {} }))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(Math, 'random').mockImplementation(() => 0.5)
})
afterAll(() => vi.restoreAllMocks())

const parse = (html: string) => {
  const box = document.createElement('div')
  box.innerHTML = html
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
