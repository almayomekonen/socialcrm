/**
 * The education catalog is a display-only mapping of the tour registry (Phase E6):
 * Hebrew catalog = registry, word for word; every step of every tour has its
 * keys; in Hebrew the localizer hands back the registry's own objects; in every
 * language the tours keep their ids, versions, step count, order, targets and
 * placement, and nothing about storage depends on the language.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { allTours } from '@/lib/education/registry'
import { localizeTourSteps, stepCopyKeys, stepTarget, tourChrome, introCopy } from '@/lib/education/tourCopy'
import { storageKey } from '@/lib/education/storage'
import { translatorFor } from '@/lib/i18n/translators'
import { UI_LOCALES } from '@/lib/i18n/config'

const he = translatorFor('he')

describe('Hebrew catalog = the registry', () => {
  for (const def of allTours()) {
    test(`${def.id}: every step has catalog keys whose Hebrew is the registry's text`, () => {
      for (const step of def.steps) {
        const keys = stepCopyKeys(def.id, step)
        expect(keys, `${def.id} / ${stepTarget(step) || '(end)'}`).not.toBeNull()
        expect(he(keys!.title)).toBe(step.title)
        expect(he(keys!.description)).toBe(step.description)
      }
    })
  }

  test('in Hebrew the localizer returns the registry steps themselves', () => {
    for (const def of allTours()) expect(localizeTourSteps(def.id, def.steps, he)).toBe(def.steps)
  })

  test('the chrome in Hebrew is exactly what runTour hard-coded before Phase E6', () => {
    expect(tourChrome(he)).toEqual({
      progressText: '{{current}} מתוך {{total}}',
      nextBtnText: 'הבא',
      prevBtnText: 'חזרה',
      doneBtnText: 'הבנתי',
      skip: 'דלג',
      fallbackLabel: 'סיור מודרך',
    })
    expect(introCopy(he)).toEqual({
      title: 'ברוכים הבאים ל־SocialCRM',
      description: 'רוצה סיור קצר במערכת?',
      start: 'התחל סיור',
      later: 'אולי אחר כך',
    })
  })
})

describe('every language: same tours, only the words differ', () => {
  for (const locale of UI_LOCALES) {
    test(`${locale}: ids, step count, order, targets and placement are unchanged`, () => {
      const t = translatorFor(locale)
      for (const def of allTours()) {
        const shown = localizeTourSteps(def.id, def.steps, t)
        expect(shown.length).toBe(def.steps.length)
        shown.forEach((step, i) => {
          const source = def.steps[i]
          expect({ element: step.element, side: step.side, align: step.align }).toEqual({
            element: source.element,
            side: source.side,
            align: source.align,
          })
          if (locale !== 'he') {
            expect(step.title).not.toMatch(/[֐-׿]/)
            expect(step.description).not.toMatch(/[֐-׿]/)
          }
        })
      }
      // Driver.js's counters must survive interpolation in every language.
      expect(tourChrome(t).progressText).toMatch(/\{\{current\}\}.*\{\{total\}\}/)
    })
  }

  test('a step the catalog does not know keeps the registry text (never dropped)', () => {
    const step = { element: '[data-edu="not-a-target"]', title: 'כותרת', description: 'תיאור' }
    expect(localizeTourSteps('lead', [step], translatorFor('en'))).toEqual([step])
  })

  test('storage is per user, never per language; the registry and its tests have no i18n import', () => {
    expect(storageKey(5)).toBe('socialcrm:education:v1:5')
    for (const file of ['lib/education/registry.ts', 'lib/education/storage.ts', 'lib/education/eligibility.ts', 'lib/education/types.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/i18n/)
    }
  })

  test('Copilot pieces stay Hebrew (AI surface, owner order): no catalog, no translator', () => {
    for (const file of ['components/education/ShowMeButton.tsx', 'lib/education/offer.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/i18n|useT\(/)
    }
  })
})
