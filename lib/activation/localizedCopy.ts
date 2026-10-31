import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { ActivationContext, ActivationStatus } from '@/lib/activation/activationState'
import { copyFor, type ScreenCopy } from '@/lib/activation/activationCopy'
import { MOBILE_HANDOFF_COPY } from '@/lib/activation/mobileHandoffCopy'

/**
 * The activation and phone-handoff copy in the interface language (Phase F4).
 *
 * `activationCopy.ts` and `mobileHandoffCopy.ts` stay the Hebrew source (their
 * tone contracts and the a11y suite are written against them): Hebrew returns
 * exactly what they return. Other languages get the same shape, field for
 * field, from `auth.activation.*` / `auth.handoff.*` (+ the shared copy-link
 * words `mobileShell.desktopOnly.copy.*`). preLoginCopyPin.test.ts pins the
 * Hebrew catalog to these modules, so the two cannot drift.
 */
export function activationCopyIn(status: ActivationStatus, ctx: ActivationContext, locale: UiLocale = 'he'): ScreenCopy {
  if (locale === 'he') return copyFor(status, ctx)
  const t = translatorFor(locale)
  const trust = [t('auth.activation.trust.secure'), t('auth.activation.trust.ownLeads'), t('auth.activation.trust.yourData')]
  switch (status) {
    case 'waitingForActivation':
      return {
        progressLabel: t('auth.activation.step'),
        heading: t('auth.activation.waiting.heading'),
        ctaLabel: t('auth.activation.start'),
        ctaLoadingLabel: t('auth.activation.connecting'),
        trust,
      }
    case 'oauthPending':
      return { heading: t('auth.activation.finishing') }
    case 'selectingPage':
      return {
        progressLabel: t('auth.activation.step'),
        heading: t('auth.activation.select.heading'),
        ctaLabel: t('auth.activation.start'),
        ctaLoadingLabel: t('auth.activation.linking'),
      }
    case 'subscribingPage':
      return { heading: t('auth.activation.subscribing') }
    case 'activationCompleted':
      return {
        progressLabel: t('auth.activation.done'),
        heading: t('auth.activation.completed.heading'),
        body: t('auth.activation.completed.body'),
        instruction: t('auth.activation.completed.instruction'),
        ctaLabel: t('mobileShell.desktopOnly.copy.label'),
        secondary: t('auth.activation.completed.secondary'),
      }
    case 'failed':
      return {
        heading: t('auth.activation.failed.heading'),
        body: t('auth.activation.failed.body'),
        ctaLabel: t('auth.activation.retry'),
        ctaLoadingLabel: t('auth.activation.connecting'),
      }
    default:
      return { heading: '' }
  }
}

export type HandoffCopy = { -readonly [K in keyof typeof MOBILE_HANDOFF_COPY]: string }

export function handoffCopyIn(locale: UiLocale = 'he'): HandoffCopy {
  if (locale === 'he') return MOBILE_HANDOFF_COPY
  const t = translatorFor(locale)
  return {
    heading: t('auth.handoff.heading'),
    body: t('auth.handoff.body'),
    copyLabel: t('mobileShell.desktopOnly.copy.label'),
    copiedLabel: t('mobileShell.desktopOnly.copy.copied'),
    copyFailedLabel: t('mobileShell.desktopOnly.copy.failed'),
    shareLabel: t('auth.handoff.share'),
    shareTitle: MOBILE_HANDOFF_COPY.shareTitle,
    shareText: t('auth.handoff.shareText'),
    soonLabel: t('auth.handoff.soon'),
    supportLink: t('auth.handoff.support'),
  }
}
