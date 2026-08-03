import 'server-only'
import { listInstalls } from '@/db/automations/templateInstalls'
import { resolveCapabilities } from '../connectors/registry'
import { evaluateRequirements, type EventAvailability } from '../requirements'
import { listTemplates } from './registry'
import { prepare } from './install'
import type { TemplateDefinition } from './types'

/**
 * Everything the marketplace renders, assembled generically.
 *
 * The page maps over `listTemplates()` and draws whatever this returns. It
 * never asks which template it is looking at.
 */

export type TemplateView = {
  template: TemplateDefinition
  availability: EventAvailability
  /** How many automations this template currently has installed here. */
  installed: number
  /** The version those installed automations were created from. */
  installedVersion: number | null
  /** A newer version exists. An OFFER — never applied to what is installed. */
  updateAvailable: boolean
  /** What changed since the installed version, newest first. */
  changes: readonly { version: number; note: string }[]
  /** Exactly what installing would create, with defaults filled in. */
  preview: { name: string; eventKey: string; actionKey: string; summary: string }[]
}

export async function templateOverview(agencyId: number): Promise<TemplateView[]> {
  const [capabilities, installs] = await Promise.all([resolveCapabilities(agencyId), listInstalls(agencyId)])
  const ctx = { capabilities, entitlements: new Set<string>(), flags: new Set<string>() }

  return listTemplates().map((template) => {
    const mine = installs.filter((i) => i.templateKey === template.key)
    const installedVersion = mine.length > 0 ? Math.min(...mine.map((i) => i.templateVersion)) : null

    return {
      template,
      availability: evaluateRequirements(template.requirements, ctx),
      installed: mine.length,
      installedVersion,
      updateAvailable: installedVersion !== null && template.version > installedVersion,
      changes: (template.changelog ?? [])
        .filter((c) => installedVersion === null || c.version > installedVersion)
        .slice()
        .sort((a, b) => b.version - a.version),
      // Defaults only: the preview answers "what would this create?", which is
      // a question about the template, not about anything the customer typed.
      preview: prepare(template).map((p) => ({
        name: p.name,
        eventKey: p.eventKey,
        actionKey: p.actionKey,
        summary: p.parameters.subject || p.parameters.title || '',
      })),
    }
  })
}
