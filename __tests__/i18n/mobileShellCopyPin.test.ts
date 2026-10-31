import { describe, expect, test } from 'vitest'
import { createTranslator } from '@/lib/i18n/translate'
import { CATALOGS } from '@/lib/i18n/messages'
import { MOBILE_TABS } from '@/components/mobile/MobileTabBar'
import { MORE_ITEMS, MORE_SECTION_LABELS, MORE_SECTION_ORDER } from '@/components/mobile/moreDestinations'
import { DESKTOP_ONLY_LEAD, DESKTOP_ONLY_SECTIONS, type DesktopOnlySection } from '@/lib/mobile/desktopOnlyRoutes'
import { MOBILE_HANDOFF_COPY } from '@/lib/activation/mobileHandoffCopy'
import {
  DESKTOP_ONLY_KEYS,
  HEADER_TITLE_KEYS,
  MORE_ITEM_KEYS,
  MORE_SECTION_KEYS,
  TAB_LABEL_KEYS,
  badgedTabName,
  desktopOnlyCopy,
  moreItemCopy,
  tabLabel,
} from '@/components/mobile/shellCopy'

/**
 * The phone shell's registries keep their Hebrew (the a11y suite asserts it) and
 * `shellCopy.ts` words them outside Hebrew by key. This pins the two together:
 * every entry has a key, the Hebrew catalog says exactly what the registry says,
 * and Hebrew returns the registry's own strings.
 */

const he = createTranslator('he', CATALOGS.he)
const en = createTranslator('en', CATALOGS.en)
const ar = createTranslator('ar', CATALOGS.ar)

describe('phone shell copy = its registries', () => {
  test('every tab has a label key whose Hebrew is the tab title', () => {
    expect(Object.keys(TAB_LABEL_KEYS).sort()).toEqual(MOBILE_TABS.map((t) => t.href as string).sort())
    for (const tab of MOBILE_TABS) {
      expect(he(TAB_LABEL_KEYS[tab.href]), tab.href).toBe(tab.title)
      expect(tabLabel(tab, he)).toBe(tab.title)
      expect(tabLabel(tab, en)).not.toBe(tab.title)
      expect(tabLabel(tab, ar)).not.toBe(tab.title)
    }
  })

  test('the badged name is the pre-i18n Hebrew for every count', () => {
    for (const tab of MOBILE_TABS) {
      for (const n of [1, 2, 3, 11, 99, 100, 1200]) expect(badgedTabName(tab.title, n, he)).toBe(`${tab.title}, ${n} חדשות`)
    }
    expect(badgedTabName('Conversations', 1200, en)).toBe('Conversations, 1200 new')
  })

  test('header titles keep their Hebrew', () => {
    expect(he(HEADER_TITLE_KEYS.lead)).toBe('ליד')
    expect(he(HEADER_TITLE_KEYS.agent)).toBe('הסוכן שלך')
  })

  test('every More section and row has keys whose Hebrew is the registry text', () => {
    for (const section of MORE_SECTION_ORDER) expect(he(MORE_SECTION_KEYS[section])).toBe(MORE_SECTION_LABELS[section])
    expect(Object.keys(MORE_ITEM_KEYS).sort()).toEqual(MORE_ITEMS.map((i) => i.href).sort())
    for (const item of MORE_ITEMS) {
      const keys = MORE_ITEM_KEYS[item.href]
      expect(he(keys.title), item.href).toBe(item.title)
      expect(he(keys.subtitle), item.href).toBe(item.subtitle)
      expect(moreItemCopy(item, he)).toEqual({ title: item.title, subtitle: item.subtitle })
      const english = moreItemCopy(item, en)
      expect(english.title).not.toBe(item.title)
      expect(english.subtitle).not.toBe(item.subtitle)
    }
  })

  test('every desktop-only section has keys whose Hebrew is the registry title and body', () => {
    const sections = Object.keys(DESKTOP_ONLY_SECTIONS) as DesktopOnlySection[]
    expect(Object.keys(DESKTOP_ONLY_KEYS).sort()).toEqual(sections.slice().sort())
    for (const section of sections) {
      const entry = DESKTOP_ONLY_SECTIONS[section]
      expect(he(DESKTOP_ONLY_KEYS[section].title), section).toBe(entry.title)
      expect(he(DESKTOP_ONLY_KEYS[section].body), section).toBe(entry.body)
      expect(desktopOnlyCopy(section, he)).toEqual(entry)
      const english = desktopOnlyCopy(section, en)
      expect(english.icon).toBe(entry.icon)
      // Every translated body opens with the same lead sentence, like the Hebrew one.
      expect(english.body.startsWith('This screen is currently available on the computer.'), section).toBe(true)
      expect(desktopOnlyCopy(section, ar).body.startsWith('هذه الشاشة متاحة حاليًا من الحاسوب.'), section).toBe(true)
      expect(entry.body.startsWith(DESKTOP_ONLY_LEAD)).toBe(true)
    }
  })

  test('the copy action keeps the activation copy in Hebrew', () => {
    expect(he('mobileShell.desktopOnly.copy.label')).toBe(MOBILE_HANDOFF_COPY.copyLabel)
    expect(he('mobileShell.desktopOnly.copy.copied')).toBe(MOBILE_HANDOFF_COPY.copiedLabel)
    expect(he('mobileShell.desktopOnly.copy.failed')).toBe(MOBILE_HANDOFF_COPY.copyFailedLabel)
  })

  test('the translated copy obeys the terminology rules (no Client entity, no emoji)', () => {
    for (const t of [en, ar]) {
      for (const section of Object.keys(DESKTOP_ONLY_SECTIONS) as DesktopOnlySection[]) {
        const { title, body } = desktopOnlyCopy(section, t)
        expect(`${title} ${body}`, section).not.toMatch(/\bclients?\b|\p{Extended_Pictographic}/iu)
      }
    }
  })
})
