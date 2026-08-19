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
