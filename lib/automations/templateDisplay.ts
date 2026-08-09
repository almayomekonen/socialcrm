import type { IconNames } from '@/lib/Icon'

/**
 * How a template PRESENTS itself: its mark, and any editorial positioning.
 *
 * COLOUR WAS REMOVED HERE, deliberately. Each template used to carry a glyph
 * hue and a 10% tile wash; four saturated marks in a row read as a Dribbble
 * shot rather than as product surface. shadcn puts icons on a muted neutral and
 * spends colour only on the primary action, so the tile is now `bg-gray-100`
 * for every template and the mark alone distinguishes them.
 *
 * Kept outside `lib/automations/catalog` and `components/settings/automations`
 * because `builderBoundary.test.ts` Law 1 forbids naming an integration in
 * either, and presentation registries are where such names collect.
 */

export type TemplateStyle = {
  /** The mark. Overrides the catalog's icon, which is chosen for the builder. */
  icon: IconNames
  /** Editorial positioning. Omitted where there is nothing honest to say. */
  highlight?: string
  /** Draws slightly heavier at rest. At most ONE template should set this. */
  featured?: boolean
}

/**
 * DELIBERATELY ABSENT: "משתמשים בו הכי הרבה". Popularity is a measurement
 * across accounts and nothing collects it; presenting a guess as usage data is
 * the class of claim that costs trust (Care Charter, Law 1). The highlights
 * below are editorial positioning, which a product may state about itself.
 */
const STYLES: Record<string, TemplateStyle> = {
  website_lead_follow_up: {
    icon: 'globe',
  },
  welcome_sequence: {
    icon: 'envelope-open-text',
    highlight: 'מומלץ',
    featured: true,
  },
  lost_lead_follow_up: {
    icon: 'rotate-left',
    highlight: 'מחזיר לידים',
  },
  contact_form_thank_you: {
    icon: 'file-lines',
  },
  appointment_reminder: {
    icon: 'bell',
    highlight: 'חוסך זמן',
  },
  internal_task_on_new_lead: {
    icon: 'user-plus',
  },
}

/** Neutral, never colourless — a new template still gets a real mark. */
const FALLBACK: TemplateStyle = {
  icon: 'bolt',
}

export function templateStyle(key: string): TemplateStyle {
  return STYLES[key] ?? FALLBACK
}
