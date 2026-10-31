import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { he } from '@/lib/i18n/messages/he'
import { copyFor } from '@/lib/activation/activationCopy'
import { MOBILE_HANDOFF_COPY } from '@/lib/activation/mobileHandoffCopy'
import { activationCopyIn, handoffCopyIn } from '@/lib/activation/localizedCopy'
import { SCOPE_LABELS_HE } from '@/lib/oauth/server/config'
import { authMessageText } from '@/components/auth/authMessageText'
import { translatorFor } from '@/lib/i18n/translators'
import { CATALOGS } from '@/lib/i18n/messages'

/**
 * Pins the Hebrew catalog of the pre-login screens (i18n Phase F4) to the
 * modules that remain the Hebrew source, and the mapped server sentences to the
 * server actions that produce them — so a copy change on either side fails here
 * instead of silently falling back to Hebrew (or wording the wrong sentence).
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const STATUSES = [
  'waitingForActivation',
  'oauthPending',
  'selectingPage',
  'subscribingPage',
  'activationCompleted',
  'failed',
  'unknown',
] as const
const CTX = { pages: [], selectedPageId: null, connectedPageName: 'X', errorReason: null }

describe('activation and handoff copy', () => {
  test('Hebrew through the localized producers = the source modules, for every status', () => {
    for (const s of STATUSES) expect(activationCopyIn(s as never, CTX, 'he')).toEqual(copyFor(s as never, CTX))
    expect(handoffCopyIn('he')).toEqual(MOBILE_HANDOFF_COPY)
  })

  test('the Hebrew catalog holds exactly the source sentences', () => {
    const a = he.auth.activation
    expect(copyFor('waitingForActivation', CTX)).toEqual({
      progressLabel: a.step,
      heading: a.waiting.heading,
      ctaLabel: a.start,
      ctaLoadingLabel: a.connecting,
      trust: [a.trust.secure, a.trust.ownLeads, a.trust.yourData],
    })
    expect(copyFor('oauthPending', CTX)).toEqual({ heading: a.finishing })
    expect(copyFor('selectingPage', CTX)).toEqual({
      progressLabel: a.step,
      heading: a.select.heading,
      ctaLabel: a.start,
      ctaLoadingLabel: a.linking,
    })
    expect(copyFor('subscribingPage', CTX)).toEqual({ heading: a.subscribing })
    expect(copyFor('activationCompleted', CTX)).toEqual({
      progressLabel: a.done,
      ...{ heading: a.completed.heading, body: a.completed.body, instruction: a.completed.instruction },
      ctaLabel: he.mobileShell.desktopOnly.copy.label,
      secondary: a.completed.secondary,
    })
    expect(copyFor('failed', CTX)).toEqual({
      heading: a.failed.heading,
      body: a.failed.body,
      ctaLabel: a.retry,
      ctaLoadingLabel: a.connecting,
    })
    const h = he.auth.handoff
    expect(MOBILE_HANDOFF_COPY).toMatchObject({
      heading: h.heading,
      body: h.body,
      shareLabel: h.share,
      shareText: h.shareText,
      soonLabel: h.soon,
      supportLink: h.support,
    })
    const c = he.mobileShell.desktopOnly.copy
    expect([MOBILE_HANDOFF_COPY.copyLabel, MOBILE_HANDOFF_COPY.copiedLabel, MOBILE_HANDOFF_COPY.copyFailedLabel]).toEqual([
      c.label,
      c.copied,
      c.failed,
    ])
  })

  test('outside Hebrew: same shape, every field worded, no Hebrew left', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const s of STATUSES) {
        const heCopy = copyFor(s as never, CTX)
        const out = activationCopyIn(s as never, CTX, locale)
        expect(Object.keys(out).sort()).toEqual(Object.keys(heCopy).sort())
        expect(JSON.stringify(out)).not.toMatch(/[֐-׿]/)
      }
      const hand = handoffCopyIn(locale)
      expect(Object.keys(hand).sort()).toEqual(Object.keys(MOBILE_HANDOFF_COPY).sort())
      expect(JSON.stringify(hand)).not.toMatch(/[֐-׿]/)
    }
  })
})

describe('OAuth consent copy', () => {
  test('scope lines, the expired sentence and the page sentences match their sources', () => {
    expect(he.auth.oauth.scope.leads).toBe(SCOPE_LABELS_HE['crm.leads.read'])
    expect(he.auth.oauth.scope.conversations).toBe(SCOPE_LABELS_HE['crm.conversations.read'])
    expect(src('lib/oauth/server/consentDecision.ts')).toContain(
      `export const CONSENT_EXPIRED = '${he.auth.oauth.message.expired}'`,
    )
    const t = translatorFor('he')
    expect(t('auth.oauth.message.unavailable', { client: 'Claude' })).toBe('לא ניתן לחבר את Claude לחשבון הזה כרגע.')
    expect(t('auth.oauth.message.needsAccess', { client: 'Claude' })).toBe(
      'כדי לחבר את Claude צריך מנוי פעיל או תקופת ניסיון פעילה.',
    )
    expect(t('auth.oauth.message.notAllowlisted', { client: 'Claude' })).toBe('החיבור ל-Claude עדיין לא זמין בחשבון שלך.')
  })
})

describe('server sentences the forms word by exact match', () => {
  const actions = src('actions/auth.ts') + src('actions/agencies.ts')
  const SERVER = Object.values(he.auth.server)

  test('every mapped server sentence is still produced, verbatim, by the actions', () => {
    for (const sentence of SERVER) expect(actions, sentence).toContain(`'${sentence}'`)
    expect(actions).toContain(`'${he.auth.social.failed}'`)
  })

  test('mapped sentences are worded; unknown ones are returned as received; Hebrew untouched', () => {
    for (const locale of ['en', 'ar'] as const) {
      const t = translatorFor(locale)
      for (const sentence of [
        ...SERVER,
        he.auth.social.failed,
        he.auth.magic.sent,
        he.auth.magic.linkInvalid,
        he.auth.magic.network,
      ]) {
        const out = authMessageText(sentence, t)
        expect(out.known).toBe(true)
        expect(out.text).not.toMatch(/[֐-׿]/)
      }
      expect(authMessageText('משהו אחר', t)).toEqual({ text: 'משהו אחר', known: false })
    }
    expect(authMessageText('משהו אחר', translatorFor('he'))).toEqual({ text: 'משהו אחר', known: true })
  })

  test('the client-side sentences the forms set are the catalog sentences', () => {
    const forms = src('components/auth/LoginMagicLink.tsx') + src('components/agencies/AddAgencyForm.tsx')
    for (const s of [he.auth.magic.sent, he.auth.magic.linkInvalid, he.auth.magic.network, he.auth.server.suspended])
      expect(forms).toContain(`'${s}'`)
  })
})

describe('root and page titles', () => {
  test('ChunkReloader and the sign-in title', async () => {
    expect(he.auth.root.chunkReloading).toBe('עדכון חדש נטען, מרענן...')
    const { CHUNK_RELOADING_KEY } = await import('@/lib/ChunkReloader')
    for (const l of ['he', 'en', 'ar'] as const)
      expect(translatorFor(l)(CHUNK_RELOADING_KEY)).toBe(CATALOGS[l].auth.root.chunkReloading)
    expect(src('app/(auth)/auth/page.tsx')).toContain(`title: '${he.auth.signIn.title}'`)
    expect(he.auth.register.title).toBe('הרשמה')
    expect(he.auth.oauth.title).toBe('חיבור אפליקציה ל-SocialCRM')
  })
})
