// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { alignment, iconButtons, iconPicker, toastBodies, uploaderFailures } from './auditFixesSurfaces'

/**
 * HEBREW BASELINE for the final UI audit fixes, recorded on UNMODIFIED code:
 * the questionnaire icon chooser's full emoji picker, the header rows / option
 * buttons aligned to the right (lead billing list, ads daily trend, ads results
 * table, document-kind picker), the icon-only buttons (the lead files upload
 * form's close, the campaign goal +/-), the uploader's failure line (too large,
 * nothing selected) and the toast body. Each is rendered with NO provider and
 * under a Hebrew `I18nProvider`; both must stay byte-identical after the fixes.
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

const same = async <T,>(f: (l: null | 'he') => Promise<T>) => {
  const none = await f(null)
  expect(await f('he'), 'a Hebrew provider renders what no provider renders').toEqual(none)
  return none
}

describe('Hebrew baseline — final UI audit fixes', () => {
  test('A: icon chooser emoji picker', async () => {
    expect(await same(iconPicker)).toMatchSnapshot()
  })
  test('D: header / option alignment', async () => {
    expect(await same(alignment)).toMatchSnapshot()
  })
  test('E: icon-only buttons', async () => {
    expect(await same(iconButtons)).toMatchSnapshot()
  })
  test('H: uploader failure line', async () => {
    expect(await same(uploaderFailures)).toMatchSnapshot()
  })
  test('G: toast body', async () => {
    expect(await same((l) => toastBodies(l, 'השינויים נשמרו'))).toMatchSnapshot()
  })
})
