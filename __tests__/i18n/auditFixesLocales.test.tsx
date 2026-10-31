// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { getByRole } from '@testing-library/dom'
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
  // Owner-approved follow-up: the library's own category headers and Clear button, outside Hebrew only.
  const LIBRARY = {
    en: { clear: 'Clear', first: 'Frequently used', last: 'Flags' },
    ar: { clear: 'مسح', first: 'الأكثر استخدامًا', last: 'الأعلام' },
  }
  const ORDER = ['suggested', 'smileys_people', 'animals_nature', 'food_drink', 'travel_places', 'activities', 'objects', 'symbols', 'flags']
  for (const locale of ['en', 'ar'] as const) {
    test(`${locale}: the library's category names and Clear label`, async () => {
      const stub = parse(await iconPicker(locale)).querySelector('[data-stub]')!
      expect(stub.getAttribute('data-clear')).toBe(LIBRARY[locale].clear)
      const cats = JSON.parse(stub.getAttribute('data-categories')!) as { category: string; name: string }[]
      expect(cats.map((c) => c.category)).toEqual(ORDER)
      expect(cats[0].name).toBe(LIBRARY[locale].first)
      expect(cats[cats.length - 1].name).toBe(LIBRARY[locale].last)
      expect(new Set(cats.map((c) => c.name)).size).toBe(ORDER.length)
      expect(cats.some((c) => HEBREW.test(c.name) || c.name.startsWith('inbox.'))).toBe(false)
    })
  }
  test('he and no provider pass nothing to the library (its built-in text, exactly as before)', async () => {
    for (const locale of ['he', null] as const) {
      const stub = parse(await iconPicker(locale)).querySelector('[data-stub]')!
      expect(stub.hasAttribute('data-clear')).toBe(false)
      expect(stub.hasAttribute('data-categories')).toBe(false)
    }
  })
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

describe('E: icon-only buttons are named in every language (owner-approved Hebrew a11y change)', () => {
  const NAMES = { he: ['סגירה', 'הוספת יעד', 'הסרת היעד האחרון'], en: ['Close', 'Add a goal', 'Remove the last goal'], ar: ['إغلاق', 'إضافة هدف', 'إزالة الهدف الأخير'] }
  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`${locale}: accessible names`, async () => {
      const out = await iconButtons(locale)
      const [close, add, remove] = NAMES[locale]
      // Exposed as the buttons' accessible names (role + name), not only as attributes.
      expect(getByRole(parse(out.fileFormClose), 'button', { name: close })).toBeTruthy()
      const goal = parse(out.goalButtons)
      expect(getByRole(goal, 'button', { name: add })).toBeTruthy()
      expect(getByRole(goal, 'button', { name: remove })).toBeTruthy()
    })
  }
  test('without a provider the buttons fall back to the Hebrew names', async () => {
    const none = await iconButtons(null)
    expect(none).toEqual(await iconButtons('he'))
  })
  test("the name is the only change to the Hebrew buttons' markup", async () => {
    const he = await iconButtons('he')
    const strip = (h: string) => h.replace(/ aria-label="[^"]*"/g, '')
    expect(strip(he.fileFormClose)).toBe(
      '<button class="flex items-center min-w-fit justify-center font-medium rounded-md flex-nowrap hover:opacity-85 size-4 p-0 absolute top-4 left-4" popovertarget="filePopover">' +
        he.fileFormClose.slice(he.fileFormClose.indexOf('<div')),
    )
    for (const locale of ['en', 'ar'] as const) {
      const out = await iconButtons(locale)
      expect(strip(out.goalButtons).replace(/>[^<]+</g, '><')).toBe(strip(he.goalButtons).replace(/>[^<]+</g, '><'))
    }
  })
  test('the file form close button sits at the end corner: right in English, left in Hebrew and Arabic', async () => {
    const cls = async (l: 'he' | 'en' | 'ar') => parse((await iconButtons(l)).fileFormClose).querySelector('button')!.className
    expect(await cls('en')).toContain('right-4')
    expect(await cls('en')).not.toContain('left-4')
    for (const l of ['he', 'ar'] as const) {
      expect(await cls(l)).toContain('left-4')
      expect(await cls(l)).not.toContain('right-4')
    }
    const strip = (h: string) => h.replace(/ aria-label="[^"]*"/g, '')
    expect(strip((await iconButtons('ar')).fileFormClose)).toBe(strip((await iconButtons('he')).fileFormClose))
  })
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
