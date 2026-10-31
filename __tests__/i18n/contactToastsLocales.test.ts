import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiLocale } from '@/lib/i18n/config'
import { CATALOGS } from '@/lib/i18n/messages'

const toastFn = vi.fn()
const resolveConversation = vi.fn()

vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => toastFn(...args) }))
vi.mock('@/modules/inbox/actions', () => ({
  resolveLeadWhatsappConversation: (...args: unknown[]) => resolveConversation(...args),
}))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: vi.fn(async () => {}) }))

import { openLeadWhatsappInInbox } from '@/modules/inbox/client/openLeadWhatsapp'
import { contactLeadViaWhatsapp } from '@/modules/leads/contactLead'

beforeEach(() => {
  toastFn.mockClear()
  resolveConversation.mockReset()
})

async function sentences(locale?: UiLocale) {
  const out: string[] = []
  for (const reason of ['no-connection', 'no-recipient', 'lead-missing']) {
    toastFn.mockClear()
    resolveConversation.mockResolvedValue({ conversationId: null, reason })
    await openLeadWhatsappInInbox(5, vi.fn(), locale ? { locale } : undefined)
    out.push(toastFn.mock.calls[0][1])
  }
  toastFn.mockClear()
  contactLeadViaWhatsapp({ id: 5, phone: null }, false, vi.fn(), 'desktop', locale ? { locale } : undefined)
  out.push(toastFn.mock.calls[0][1])
  return out
}

describe('contact toasts follow the interface language', () => {
  it('no locale and he stay the original Hebrew sentences', async () => {
    const he = [
      'יש לחבר WhatsApp בהגדרות לפני פתיחת שיחה',
      'לליד אין מספר טלפון תקין לשיחת WhatsApp',
      'לא ניתן לפתוח שיחת WhatsApp לליד זה כרגע',
      'לליד אין מספר טלפון תקין לוואטסאפ',
    ]
    expect(await sentences()).toEqual(he)
    expect(await sentences('he')).toEqual(he)
  })

  it.each(['en', 'ar'] as const)('%s words every toast from its catalog, with no Hebrew', async (locale) => {
    const c = CATALOGS[locale].leads.contact
    const got = await sentences(locale)
    expect(got).toEqual([c.noConnection, c.noRecipient, c.unavailable, c.noValidPhone])
    for (const s of got) expect(s).not.toMatch(/[֐-׿]/)
  })

  it('the outcome codes are identical in every locale', async () => {
    for (const locale of ['he', 'en', 'ar'] as const) {
      resolveConversation.mockResolvedValue({ conversationId: null, reason: 'no-recipient' })
      expect((await openLeadWhatsappInInbox(5, vi.fn(), { locale })).kind).toBe('no-recipient')
    }
  })
})

/** The argument list of a call, up to its balanced closing parenthesis. */
function callText(src: string, from: number): string {
  let depth = 1
  let i = from
  while (i < src.length && depth > 0) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') depth--
    i++
  }
  return src.slice(from, i)
}

/** Every button that contacts a lead hands its interface language to the toast. */
describe('every contact call site passes the locale', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name)) files.push(p)
    }
  }
  walk('components')
  walk('modules')
  const DEFINERS = ['modules/leads/contactLead.ts', 'modules/inbox/client/openLeadWhatsapp.ts']

  const sites = files
    .filter((f) => !DEFINERS.includes(f))
    .flatMap((f) => {
      const src = readFileSync(f, 'utf8')
      const found: { file: string; call: string }[] = []
      for (const m of src.matchAll(/(contactLeadViaWhatsapp|openLeadWhatsappInInbox)\(/g)) {
        found.push({ file: f, call: callText(src, m.index! + m[0].length) })
      }
      return found
    })

  it('finds the known call sites (not vacuous)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(5)
  })

  it.each(sites.map((s) => [s.file, s.call] as const))('%s', (_file, call) => {
    expect(call).toContain('locale: t.locale')
  })
})
