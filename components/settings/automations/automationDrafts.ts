import { AUTOMATION_RECIPES } from '@/lib/automations/recipes'
import { listSelectableEvents } from '@/lib/automations/catalog/registry'
import type { SheetDraft } from './AutomationSheet'

/**
 * Sheet drafts, as pure data mapping.
 *
 * Extracted from the page so the orchestrator stays an orchestrator: turning a
 * recipe into a draft is a translation, not a decision about what is on screen.
 */

export const DRAFT_FROM_RECIPE = (key: string): SheetDraft | null => {
  const r = AUTOMATION_RECIPES.find((x) => x.key === key)
  if (!r) return null
  return {
    name: r.name,
    recipeKey: r.key,
    eventKey: r.eventKey,
    conditions: [...r.conditions],
    connectionId: null,
    parameters: {},
    subject: r.subject,
    body: r.body,
    // Recipes ship no CTA: the starter content is plain copy, and the block is
    // something the customer chooses to add.
    cta: null,
    // Every shipped recipe authors an email; a title-shaped action starts blank.
    title: '',
    actionParameters: {},
    timing: r.timing,
  }
}

/** The blank draft opens on the first catalog event — no hardcoded trigger. */
export const BLANK: SheetDraft = {
  name: '',
  recipeKey: null,
  eventKey: listSelectableEvents()[0]?.key ?? '',
  conditions: [],
  connectionId: null,
  parameters: {},
  subject: '',
  body: '',
  cta: null,
  title: '',
  actionParameters: {},
  timing: { kind: 'preset', preset: 'immediate' },
}
