import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { catalog, getEvent, listActionsForEvent, listSelectableEvents } from '@/lib/automations/catalog/registry'
import { validateCatalog } from '@/lib/automations/catalog/validate'
import { listTemplates } from '@/lib/automations/templates/registry'
import { validateTemplate } from '@/lib/automations/templates/install'
import { AUTOMATION_RECIPES } from '@/lib/automations/recipes'
import { evaluateEvents, isSelectable } from '@/lib/automations/requirements'
import { resolveCapabilities } from '@/lib/automations/connectors/resolve'
import { whatsappProvider } from '@/lib/automations/connectors/whatsapp'
import { contactForm7Provider } from '@/lib/automations/connectors/contactForm7'
import { bridgedEventKeys, engineTriggerForEventKey } from '@/lib/automations/catalog/engineBridge'
import { STRATEGY } from '@/components/settings/connections/copy'
import { AUTH_STRATEGIES } from '@/lib/automations/catalog/vocabularies'

/**
 * THE APPOINTMENTS AREA IS INTERNALLY CONSISTENT after removing the scheduling
 * connector.
 *
 * Every assertion here is a thing that WOULD have been left dangling by a partial
 * removal: a requirement nothing can satisfy, a template permanently locked, a
 * capability no provider grants, an event nothing produces, a file still
 * importing what was deleted. Written as a test rather than checked once, so the
 * next removal cannot quietly reintroduce any of them.
 */

const PROVIDERS = [whatsappProvider, contactForm7Provider]

/** Every capability any registered provider can grant. */
const GRANTABLE = new Set(PROVIDERS.flatMap((p) => [...p.capabilities]))

/** Requirement keys named anywhere in the catalog or the marketplace. */
const requiredKeys = (): string[] => [
  ...catalog.events.flatMap((e) => e.requirements.map((r) => r.key)),
  ...listTemplates().flatMap((t) => t.requirements.map((r) => r.key)),
]

describe('no dead requirements — every gate can actually be opened', () => {
  it('every connection requirement names a capability some provider grants', () => {
    for (const key of requiredKeys()) {
      expect(GRANTABLE.has(key), `requirement "${key}" is satisfiable by no registered provider`).toBe(true)
    }
  })

  it('no requirement names the removed scheduling capability', () => {
    expect(requiredKeys()).not.toContain('calendar_connected')
  })

  it('no provider grants a capability nothing asks for', () => {
    // An orphan capability is dead weight: it can be satisfied but unlocks
    // nothing, so the customer connects something for no reason.
    const asked = new Set(requiredKeys())
    for (const capability of GRANTABLE) {
      // WhatsApp predates the Connection layer and grants its capability for the
      // inbox rather than for an automation gate, so it is exempt by design.
      if (whatsappProvider.capabilities.includes(capability)) continue
      expect(asked.has(capability), `capability "${capability}" is granted but never required`).toBe(true)
    }
  })
})

describe('no locked templates — the marketplace is installable', () => {
  it('every template passes validation against the live catalog', () => {
    for (const template of listTemplates()) {
      expect(validateTemplate(template), `template "${template.key}" is not installable`).toEqual([])
    }
  })

  it('every template requirement is satisfiable, so no card is permanently locked', () => {
    for (const template of listTemplates()) {
      for (const requirement of template.requirements) {
        expect(
          GRANTABLE.has(requirement.key),
          `template "${template.key}" is locked behind "${requirement.key}", which nothing can grant`,
        ).toBe(true)
      }
    }
  })

  it('the appointment category holds exactly the customer-facing reminder', () => {
    const appointment = listTemplates().filter((t) => t.category === 'appointment')
    expect(appointment.map((t) => t.key)).toEqual(['appointment_reminder'])
    expect(appointment[0].title).toBe('תזכורת לפני פגישה')
    // It needs no connection, so it is available to every agency immediately.
    expect(appointment[0].requirements).toEqual([])
  })

  it('the removed templates are gone from the registry', () => {
    const keys = listTemplates().map((t) => t.key)
    expect(keys).not.toContain('appointment_confirmation')
    expect(keys).not.toContain('appointment_reminder_task')
  })
})

describe('no unused events — everything registered has a producer and a consumer', () => {
  it('the appointment event is selectable in the Builder, not locked out', () => {
    const evaluated = evaluateEvents(listSelectableEvents(), { capabilities: new Set<string>(), plan: null } as never)
    const appointment = evaluated.find((e) => e.event.key === 'appointment.booked')
    expect(appointment, 'appointment.booked is not offered by the Builder').toBeDefined()
    // Selectable with NO capabilities at all — the Meetings domain always exists.
    expect(isSelectable(appointment!.availability)).toBe(true)
  })

  it('every catalog event is bridged to an engine trigger', () => {
    for (const event of catalog.events) {
      expect(engineTriggerForEventKey(event.key), `event "${event.key}" has no engine trigger`).toBeTruthy()
    }
    expect(bridgedEventKeys().length).toBe(catalog.events.length)
  })

  it('every catalog event can offer at least one action', () => {
    for (const event of catalog.events) {
      expect(listActionsForEvent(event).length, `event "${event.key}" can run nothing`).toBeGreaterThan(0)
    }
  })

  it('every catalog event is named by a template or a recipe', () => {
    const used = new Set([
      ...listTemplates().flatMap((t) => t.automations.map((a) => a.eventKey)),
      ...AUTOMATION_RECIPES.map((r) => r.eventKey),
    ])
    for (const event of catalog.events) {
      expect(used.has(event.key), `event "${event.key}" is registered but nothing uses it`).toBe(true)
    }
  })

  it('the appointment event carries no field the removed connector shaped', () => {
    const fields = getEvent('appointment.booked')!.fields.map((f) => f.key)
    // The invitee concept belonged to a third-party scheduling payload. The
    // Meetings domain's equivalent is the lead's own email, already declared.
    expect(fields).not.toContain('inviteeEmail')
    expect(fields).toContain('email')
    // The anchor the reminder counts back from must still be there.
    expect(fields).toContain('startsAt')
  })
})

describe('no orphan capabilities or unreachable connect flows', () => {
  it('the catalog still validates as a whole', () => {
    expect(validateCatalog(catalog)).toEqual([])
  })

  it('every registered integration has a provider behind it', async () => {
    for (const integration of catalog.integrations) {
      const provider = PROVIDERS.find((p) => p.integrationKey === integration.key)
      expect(provider, `integration "${integration.key}" has no connector`).toBeDefined()
      expect(provider!.capabilities).toEqual(integration.capabilities)
    }
  })

  it('every auth strategy the catalog uses has a flow that exists', () => {
    for (const integration of catalog.integrations) {
      expect(
        STRATEGY[integration.auth].needsConnection,
        `integration "${integration.key}" declares "${integration.auth}", which offers no way to connect`,
      ).toBe(true)
    }
  })

  it('provider-hosted strategies are honestly marked as unavailable', () => {
    // They stay in the closed vocabulary so re-adding one is a deliberate act,
    // but no card may offer a button for a flow that does not exist.
    for (const auth of AUTH_STRATEGIES) {
      if (auth === 'oauth2' || auth === 'embedded_signup') {
        expect(STRATEGY[auth].needsConnection).toBe(false)
        expect(STRATEGY[auth].how, `strategy "${auth}" offers no explanation`).toBeTruthy()
      }
    }
  })

  it('resolves capabilities from the two remaining providers without error', async () => {
    // The registry lost a provider; this proves nothing downstream assumed three.
    await expect(resolveCapabilities(PROVIDERS as never, 7)).resolves.toBeInstanceOf(Set)
  })
})

describe('no unreachable code — nothing imports what was removed', () => {
  /**
   * PRODUCTION directories only.
   *
   * Tests legitimately name integrations that do not exist — the Builder and the
   * Connections page are asserted NOT to hardcode any integration key, and that
   * check needs unregistered names to test against. Production code naming a
   * removed integration is the actual defect, and that is what this scans for.
   */
  const ROOTS = ['lib', 'actions', 'components', 'app', 'db']
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry !== 'node_modules' && !entry.startsWith('.')) walk(full)
      } else if (/\.tsx?$/.test(entry)) {
        files.push(full)
      }
    }
  }
  for (const root of ROOTS) walk(root)

  it('scanned a meaningful part of the tree', () => {
    expect(files.length).toBeGreaterThan(300)
  })

  it('the deleted provider file is really gone', () => {
    expect(files.some((f) => f.endsWith('connectors/calendly.ts'))).toBe(false)
  })

  it('no file imports the deleted connector', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('connectors/calendly'))
    expect(offenders).toEqual([])
  })

  it('no file links to the deleted connect route', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('automations/connect/'))
    expect(offenders).toEqual([])
  })

  it('no production file names the removed integration at all', () => {
    const offenders = files.filter((f) => /calendly/i.test(readFileSync(f, 'utf8')))
    expect(offenders, 'stale references to a removed integration confuse the next reader').toEqual([])
  })
})
