import { describe, expect, it, vi } from 'vitest'
import { emitAutomationEventWith, eventKeyFor, type EmitDeps } from '@/lib/automations/emit'
import type { AutomationDefinition } from '@/db/automations/definitions'
import type { AutomationTriggerEvent } from '@/lib/automations/types'

// Emission gate tests (DI, DB-less): gate order, kill-switch shadow metrics,
// import inertness at the emission layer, contract-faithful enqueue args, and
// the never-throws guarantee call sites in protected files depend on.

const T0 = new Date('2026-08-02T12:00:00Z')

function event(overrides: Partial<AutomationTriggerEvent> = {}): AutomationTriggerEvent {
  return {
    trigger: 'lead_created',
    origin: 'webhook_facebook',
    agencyId: 7,
    leadId: 42,
    occurredAt: T0,
    leadSource: 'facebook:123',
    ...overrides,
  }
}

function definition(id: number, timing: unknown = { kind: 'preset', preset: 'immediate' }): AutomationDefinition {
  return {
    id,
    agencyId: 7,
    name: 'אימייל פתיחה',
    recipeKey: 'welcome_new_lead',
    status: 'active',
    trigger: 'lead_created',
    targetStatus: null,
    sourceFilter: null,
    action: 'send_email',
    content: { schemaVersion: 1, subject: 's', body: 'b', timing: timing as never },
    createdByUserId: 1,
  }
}

function makeDeps(overrides: Partial<EmitDeps> = {}): EmitDeps {
  return {
    enabled: () => true,
    allowlisted: () => true,
    listActive: vi.fn(async () => [definition(3)]),
    enqueue: vi.fn(async () => 101),
    shadow: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('eventKeyFor — ADR-010 identity rules', () => {
  it('lead_created identity is the lead itself', () => {
    expect(eventKeyFor(event())).toBe('lead_created')
  })

  it('status_changed identity anchors on newStatus + business timestamp', () => {
    const e = event({ trigger: 'status_changed', newStatus: 'closed', leadSource: undefined })
    expect(eventKeyFor(e)).toBe(`status_changed:closed:${T0.getTime()}`)
  })

  it('is deterministic — a retry of the same business event collapses', () => {
    const e1 = event({ trigger: 'status_changed', newStatus: 'closed' })
    const e2 = event({ trigger: 'status_changed', newStatus: 'closed' })
    expect(eventKeyFor(e1)).toBe(eventKeyFor(e2))
  })
})

describe('emission gates, cheapest first', () => {
  it('import origin is inert BEFORE any gate — no shadow, no DB, no enqueue', async () => {
    const deps = makeDeps({ enabled: () => false })
    const res = await emitAutomationEventWith(deps, event({ origin: 'import' }))
    expect(res).toEqual({ blocked: 'origin_import' })
    expect(deps.shadow).not.toHaveBeenCalled()
    expect(deps.listActive).not.toHaveBeenCalled()
    expect(deps.enqueue).not.toHaveBeenCalled()
  })

  it('kill switch blocks with a shadow metric carrying the full event identity, touching no storage', async () => {
    const deps = makeDeps({ enabled: () => false })
    const res = await emitAutomationEventWith(deps, event())
    expect(res).toEqual({ blocked: 'kill_switch' })
    expect(deps.shadow).toHaveBeenCalledTimes(1)
    expect(deps.shadow).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'lead_created', origin: 'webhook_facebook', agencyId: 7, leadId: 42 }),
    )
    expect(deps.listActive).not.toHaveBeenCalled()
    expect(deps.enqueue).not.toHaveBeenCalled()
  })

  it('non-allowlisted agency blocks quietly (shadow is kill-switch-only by instruction)', async () => {
    const deps = makeDeps({ allowlisted: () => false })
    const res = await emitAutomationEventWith(deps, event())
    expect(res).toEqual({ blocked: 'agency_not_allowlisted' })
    expect(deps.shadow).not.toHaveBeenCalled()
    expect(deps.enqueue).not.toHaveBeenCalled()
  })

  it('no active definitions blocks after the definition lookup', async () => {
    const deps = makeDeps({ listActive: vi.fn(async () => []) })
    const res = await emitAutomationEventWith(deps, event())
    expect(res).toEqual({ blocked: 'no_active_definitions' })
    expect(deps.enqueue).not.toHaveBeenCalled()
  })
})

describe('enqueue — contract-faithful, one job per active definition', () => {
  it('passes the exact ADR-010 fields and resolved notBefore', async () => {
    const deps = makeDeps()
    const res = await emitAutomationEventWith(deps, event())
    expect(res).toEqual({ emitted: 1, skippedDefinitions: 0, filteredDefinitions: 0 })
    expect(deps.enqueue).toHaveBeenCalledWith({
      agencyId: 7,
      automationId: 3,
      leadId: 42,
      trigger: 'lead_created',
      origin: 'webhook_facebook',
      eventKey: 'lead_created',
      notBefore: T0, // immediate preset = the business moment
    })
  })

  it('resolves delayed timing from the business moment, not emission time', async () => {
    const deps = makeDeps({ listActive: vi.fn(async () => [definition(3, { kind: 'preset', preset: 'one_hour' })]) })
    await emitAutomationEventWith(deps, event())
    const args = (deps.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.notBefore.getTime()).toBe(T0.getTime() + 3_600_000)
  })

  it('fans out one job per definition; invalid stored timing holds that definition inert', async () => {
    const deps = makeDeps({
      listActive: vi.fn(async () => [definition(3), definition(4, { kind: 'nonsense' }), definition(5)]),
    })
    const res = await emitAutomationEventWith(deps, event())
    expect(res).toEqual({ emitted: 2, skippedDefinitions: 1, filteredDefinitions: 0 })
    expect(deps.enqueue).toHaveBeenCalledTimes(2)
  })

  it('conflict-ignored enqueues (null id) do not count as emitted', async () => {
    const deps = makeDeps({ enqueue: vi.fn(async () => null) })
    const res = await emitAutomationEventWith(deps, event())
    expect(res).toEqual({ emitted: 0, skippedDefinitions: 0, filteredDefinitions: 0 })
  })

  it('source filters apply at emission: non-matching definitions never get jobs', async () => {
    const facebookOnly = { ...definition(3), sourceFilter: 'facebook' }
    const anySource = definition(4)
    const deps = makeDeps({ listActive: vi.fn(async () => [facebookOnly, anySource]) })

    const fbRes = await emitAutomationEventWith(deps, event({ leadSource: 'facebook:123' }))
    expect(fbRes).toEqual({ emitted: 2, skippedDefinitions: 0, filteredDefinitions: 0 })

    const waRes = await emitAutomationEventWith(deps, event({ leadSource: 'whatsapp:999' }))
    expect(waRes).toEqual({ emitted: 1, skippedDefinitions: 0, filteredDefinitions: 1 })

    const noSource = await emitAutomationEventWith(deps, event({ leadSource: undefined }))
    expect(noSource).toEqual({ emitted: 1, skippedDefinitions: 0, filteredDefinitions: 1 })
  })
})

describe('the never-throws guarantee', () => {
  it('a throwing dependency is swallowed into a blocked result', async () => {
    const deps = makeDeps({ enqueue: vi.fn(async () => Promise.reject(new Error('db down'))) })
    await expect(emitAutomationEventWith(deps, event())).resolves.toEqual({ blocked: 'error' })
  })

  it('a throwing shadow is swallowed too', async () => {
    const deps = makeDeps({
      enabled: () => false,
      shadow: vi.fn(async () => Promise.reject(new Error('analytics down'))),
    })
    await expect(emitAutomationEventWith(deps, event())).resolves.toEqual({ blocked: 'error' })
  })
})
