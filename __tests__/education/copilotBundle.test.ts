import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const COPILOT_PATHS = [
  'actions/ai/askGeneralQuestion.ts',
  'components/copilot/general/AnswerView.tsx',
  'components/education/ShowMeButton.tsx',
  'lib/education/actions.ts',
  'lib/education/offer.ts',
  'lib/copilot/general/guideMap.ts',
]

describe('Copilot must not import Driver.js', () => {
  it('keeps Driver.js and runTour off the Copilot / action path', () => {
    for (const rel of COPILOT_PATHS) {
      const src = readFileSync(rel, 'utf8')
      expect(src, rel).not.toMatch(/driver\.js/)
      expect(src, rel).not.toMatch(/from ['\"]\.\/runTour['\"]/)
      expect(src, rel).not.toMatch(/from ['\"]@\/components\/education\/runTour['\"]/)
    }
  })
})

describe('education CSS load order', () => {
  it('loads Driver.js CSS before the SocialCRM skin, and not from the global bundle', () => {
    const runTour = readFileSync('components/education/runTour.ts', 'utf8')
    const driverCss = runTour.indexOf("import('driver.js/dist/driver.css')")
    const eduCss = runTour.indexOf("import('@/lib/css/education.css')")
    expect(driverCss).toBeGreaterThan(-1)
    expect(eduCss).toBeGreaterThan(driverCss)
    expect(runTour.indexOf('Promise.all')).toBe(-1)

    const mainCss = readFileSync('lib/css/main.css', 'utf8')
    expect(mainCss).not.toMatch(/education\.css/)
  })
})

describe('education overlay and RTL skin', () => {
  it('does not paint an opaque CSS background on the Driver.js SVG overlay', () => {
    const css = readFileSync('lib/css/education.css', 'utf8')
    expect(css).toMatch(/\.driver-overlay\s*\{[^}]*background:\s*transparent/)
    expect(css).not.toMatch(/\.driver-overlay\s*\{[^}]*background:\s*#0a2540/)
  })

  it('forces RTL on the popover skin', () => {
    const css = readFileSync('lib/css/education.css', 'utf8')
    expect(css).toMatch(/\.edu-popover\s*\{[^}]*direction:\s*rtl/)
  })

  it('configures a translucent ink overlay and Hebrew tour chrome', () => {
    const src = readFileSync('components/education/runTour.ts', 'utf8')
    // The overlay config every Driver.js run shares lives in tourPopover.ts (baseDriverConfig).
    const shared = readFileSync('components/education/tourPopover.ts', 'utf8')
    expect(shared).toMatch(/overlayColor:\s*'#0a2540'/)
    expect(shared).toMatch(/overlayOpacity:\s*0\.45/)
    expect(src.match(/\.\.\.baseDriverConfig\(reduceMotion\)/g)?.length).toBe(2)
    // The chrome words come from the catalog (Phase E6); in Hebrew they are the same words,
    // and Driver.js's counters are passed through as {{current}} / {{total}}.
    const chrome = readFileSync('lib/i18n/messages/he/education/chrome.ts', 'utf8')
    expect(src).toContain('nextBtnText: chrome.nextBtnText')
    expect(src).toContain('prevBtnText: chrome.prevBtnText')
    expect(src).toContain('doneBtnText: chrome.doneBtnText')
    expect(src).toContain('progressText: chrome.progressText')
    expect(chrome).toContain("next: 'הבא'")
    expect(chrome).toContain("prev: 'חזרה'")
    expect(chrome).toContain("done: 'הבנתי'")
    expect(chrome).toContain("progress: '{current} מתוך {total}'")
    expect(readFileSync('lib/education/tourCopy.ts', 'utf8')).toContain("{ current: '{{current}}', total: '{{total}}' }")
    // The popover decoration (dir, role, the extra footer button) lives in tourPopover.ts.
    const popover = readFileSync('components/education/tourPopover.ts', 'utf8')
    expect(popover).toMatch(/setAttribute\('dir',\s*'rtl'\)/)
    expect(src).toContain("extra: { text: chrome.skip, onClick: () => finish('dismissed') }")
    expect(chrome).toContain("skip: 'דלג'")
    expect(popover).toContain('extra.textContent = opts.extra.text')
  })
})
