// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { findHebrewLeaks } from './leakScan'
import { alignment, iconButtons, iconPicker, readyMessageChevrons, toastBodies, uploaderFailures } from './auditFixesSurfaces'

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

describe('E: icon-only buttons are named outside Hebrew; Hebrew stays unnamed', () => {
  const NAMES = { en: ['Close', 'Add a goal', 'Remove the last goal'], ar: ['إغلاق', 'إضافة هدف', 'إزالة الهدف الأخير'] }
  for (const locale of ['en', 'ar'] as const) {
    test(locale, async () => {
      const he = await iconButtons(null)
      const out = await iconButtons(locale)
      const [close, add, remove] = NAMES[locale]
      expect(parse(out.fileFormClose).querySelector('button')!.getAttribute('aria-label')).toBe(close)
      const goal = [...parse(out.goalButtons).querySelectorAll('button')]
      expect(goal.slice(0, 2).map((b) => b.getAttribute('aria-label'))).toEqual([add, remove])
      // Same markup otherwise: removing the name gives back the Hebrew button exactly.
      const strip = (h: string) => h.replace(/ aria-label="[^"]*"/g, '')
      expect(strip(out.fileFormClose)).toBe(he.fileFormClose)
      expect(strip(out.goalButtons).replace(/>[^<]+</g, '><')).toBe(he.goalButtons.replace(/>[^<]+</g, '><'))
      expect(he.fileFormClose).not.toContain('aria-label')
      expect(he.goalButtons.split('\n').slice(0, 2).join('')).not.toContain('aria-label')
    })
  }
})

describe('G: a toast body declares the interface language; a verbatim Hebrew sentence stays Hebrew', () => {
  const CASES = { en: { sentence: 'Changes saved', dir: 'ltr' }, ar: { sentence: 'تم حفظ التغييرات', dir: 'rtl' } }
  for (const locale of ['en', 'ar'] as const) {
    test(locale, async () => {
      const { sentence, dir } = CASES[locale]
      const out = await toastBodies(locale, sentence)
      const body = (key: keyof typeof out) => parse(out[key]).querySelector('#popMsg > div')!
      expect([body('sentence').getAttribute('lang'), body('sentence').getAttribute('dir')]).toEqual([locale, dir])
      expect(body('sentence').textContent).toBe(sentence)
      expect([body('verbatimHebrew').getAttribute('lang'), body('verbatimHebrew').getAttribute('dir')]).toEqual(['he', 'rtl'])
      expect(body('verbatimHebrew').textContent).toBe('הליד נשמר בהצלחה')
      expect([body('default').getAttribute('lang'), body('default').getAttribute('dir')]).toEqual([locale, dir])
      expect(HEBREW.test(body('default').textContent!)).toBe(false)
      // Nothing else changes: without the two attributes the body is the Hebrew-provider markup.
      const he = await toastBodies('he', sentence)
      expect(out.sentence.replace(/ lang="\w+" dir="\w+"/, '')).toBe(he.sentence)
    })
  }
})

describe("H: the uploader's own refusals are worded in the interface language", () => {
  const WORDS = {
    en: { tooLarge: 'File upload failed: the file is too large', noneSelected: 'File upload failed: no files were selected' },
    ar: { tooLarge: 'فشل رفع الملفات: الملف كبير جدًا', noneSelected: 'فشل رفع الملفات: لم يتم اختيار أي ملف' },
  }
  for (const locale of ['en', 'ar'] as const) {
    test(locale, async () => {
      const out = await uploaderFailures(locale)
      for (const key of ['tooLarge', 'noneSelected'] as const) {
        const dialog = parse(out[key]).firstElementChild!
        expect(dialog.getAttribute('aria-label'), key).toBe(WORDS[locale][key])
        expect(dialog.textContent, key).toContain(WORDS[locale][key])
        expect(findHebrewLeaks(dialog, []), key).toEqual([])
      }
    })
  }

  test('the Hebrew catalog words are the exact sentences uploadS3 throws', async () => {
    const { UPLOAD_NONE_SELECTED, UPLOAD_TOO_LARGE } = await import('@/components/files/funcs')
    const { translatorFor } = await import('@/lib/i18n/translators')
    const he = translatorFor('he')
    expect([he('leadTabs.files.uploader.tooLarge'), he('leadTabs.files.uploader.noneSelected')]).toEqual([UPLOAD_TOO_LARGE, UPLOAD_NONE_SELECTED])
    const source = (await import('node:fs')).readFileSync('components/files/funcs.tsx', 'utf8')
    expect(source).toContain('throw new Error(UPLOAD_NONE_SELECTED)')
    expect(source).toContain('throw new Error(UPLOAD_TOO_LARGE)')
  })
})
