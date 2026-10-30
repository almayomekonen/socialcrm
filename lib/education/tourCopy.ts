import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { EDU_ATTR } from './types'
import type { TourId, TourStep } from './types'

/**
 * Display-only wording of the product tours in the interface language (Phase E6).
 *
 * The registry (`registry.ts`) stays the one source of WHICH steps a tour has,
 * their order, targets and placement — and its Hebrew is what Hebrew users see:
 * in Hebrew every function here returns the registry's own objects. Outside
 * Hebrew a step's title and description come from `education.tours.*`, keyed
 * by tour and by the step's target. Ids, versions, storage keys, eligibility
 * and targets never depend on the language.
 */

/** Catalog keys per step target; `''` is the closing step without a target. Written out in full so the coverage check sees them. */
type StepKeys = { title: MessageKey; description: MessageKey }

// Plain strings here (checked against the catalog by educationCopyPin.test.ts):
// typing 50 literals as MessageKey costs the compiler more than it can spare.
const STEP_KEYS: Record<TourId, Record<string, { title: string; description: string }>> = {
  overview: {
    'nav-today': { title: 'education.tours.overview.today.title', description: 'education.tours.overview.today.description' },
    'nav-leads': { title: 'education.tours.overview.leads.title', description: 'education.tours.overview.leads.description' },
    'nav-clients': { title: 'education.tours.overview.clients.title', description: 'education.tours.overview.clients.description' },
    'nav-inbox': { title: 'education.tours.overview.inbox.title', description: 'education.tours.overview.inbox.description' },
    'nav-deals': { title: 'education.tours.overview.deals.title', description: 'education.tours.overview.deals.description' },
    'nav-performance': { title: 'education.tours.overview.performance.title', description: 'education.tours.overview.performance.description' },
    'nav-tasks': { title: 'education.tours.overview.tasks.title', description: 'education.tours.overview.tasks.description' },
    'nav-calendar': { title: 'education.tours.overview.calendar.title', description: 'education.tours.overview.calendar.description' },
    'nav-settings': { title: 'education.tours.overview.settings.title', description: 'education.tours.overview.settings.description' },
    header: { title: 'education.tours.overview.header.title', description: 'education.tours.overview.header.description' },
    'copilot-trigger': { title: 'education.tours.overview.copilot.title', description: 'education.tours.overview.copilot.description' },
    notifications: { title: 'education.tours.overview.notifications.title', description: 'education.tours.overview.notifications.description' },
    '': { title: 'education.tours.overview.end.title', description: 'education.tours.overview.end.description' },
  },
  pipeline: {
    'leads-table': { title: 'education.tours.pipeline.table.title', description: 'education.tours.pipeline.table.description' },
    'lead-status-tabs': { title: 'education.tours.pipeline.statuses.title', description: 'education.tours.pipeline.statuses.description' },
    'lead-open': { title: 'education.tours.pipeline.open.title', description: 'education.tours.pipeline.open.description' },
    'leads-add': { title: 'education.tours.pipeline.add.title', description: 'education.tours.pipeline.add.description' },
    '': { title: 'education.tours.pipeline.end.title', description: 'education.tours.pipeline.end.description' },
  },
  lead: {
    'lead-status': { title: 'education.tours.lead.status.title', description: 'education.tours.lead.status.description' },
    'lead-followup': { title: 'education.tours.lead.followUp.title', description: 'education.tours.lead.followUp.description' },
  },
  copilot: {
    'copilot-trigger': { title: 'education.tours.copilot.trigger.title', description: 'education.tours.copilot.trigger.description' },
  },
  whatsapp: {
    'whatsapp-section': { title: 'education.tours.whatsapp.section.title', description: 'education.tours.whatsapp.section.description' },
    'whatsapp-connect': { title: 'education.tours.whatsapp.connect.title', description: 'education.tours.whatsapp.connect.description' },
  },
  facebook: {
    'facebook-section': { title: 'education.tours.facebook.section.title', description: 'education.tours.facebook.section.description' },
    'facebook-connect': { title: 'education.tours.facebook.connect.title', description: 'education.tours.facebook.connect.description' },
  },
}

const SELECTOR = new RegExp(`^\\[${EDU_ATTR}="([^"]+)"\\]$`)

/** The `data-edu` id a step points at (`''` for an untargeted step). */
export function stepTarget(step: TourStep): string {
  if (!step.element) return ''
  return SELECTOR.exec(step.element)?.[1] ?? step.element
}

/** The catalog keys for one step, or null for a step the catalog does not know. */
export function stepCopyKeys(id: TourId, step: TourStep): StepKeys | null {
  const keys = STEP_KEYS[id]?.[stepTarget(step)]
  return keys ? { title: keys.title as MessageKey, description: keys.description as MessageKey } : null
}

/**
 * The steps as shown. Hebrew: the registry's steps themselves. Otherwise a copy
 * with the same targets and placement and translated words; a step the catalog
 * does not know keeps the registry's text (it is still shown, never dropped).
 */
export function localizeTourSteps(id: TourId, steps: TourStep[], t: Translator): TourStep[] {
  if (t.locale === 'he') return steps
  return steps.map((step) => {
    const keys = stepCopyKeys(id, step)
    if (!keys) return step
    return { ...step, title: t(keys.title), description: t(keys.description) }
  })
}

/** Driver.js chrome for a tour, in the interface language. */
export function tourChrome(t: Translator) {
  return {
    progressText: t('education.chrome.progress', { current: '{{current}}', total: '{{total}}' }),
    nextBtnText: t('education.chrome.next'),
    prevBtnText: t('education.chrome.prev'),
    doneBtnText: t('education.chrome.done'),
    skip: t('education.chrome.skip'),
    fallbackLabel: t('education.chrome.fallbackLabel'),
  }
}

/** The first-time Help spotlight's words, in the interface language. */
export function introCopy(t: Translator) {
  return {
    title: t('education.intro.title'),
    description: t('education.intro.description'),
    start: t('education.intro.start'),
    later: t('education.intro.later'),
  }
}
