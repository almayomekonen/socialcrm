import { describe, expect, it } from 'vitest'
import {
  connectionHealth,
  isConnectionProblem,
  listAllConnections,
  listSourcesFor,
  optionsFor,
  providerForConnection,
  resolveCapabilities,
} from '@/lib/automations/connectors/resolve'
import type { ConnectionProvider } from '@/lib/automations/connectors/types'
import type { Connection, Source } from '@/lib/automations/catalog/types'
import type { ConnectionHealth } from '@/lib/automations/catalog/vocabularies'
import { evaluateEvent, type RequirementContext } from '@/lib/automations/requirements'
import type { EventDefinition } from '@/lib/automations/catalog/types'

/**
 * B4 Part A — the Connection layer, proved against FAKE providers.
 *
 * The point of these tests is not that WhatsApp works; it is that the layer is
 * generic. Every provider below is invented, and none of the code under test
 * has ever heard of it. If adding an integration required a change anywhere
 * but its own module, these tests could not be written.
 */

/** A provider whose connections and sources are given, not fetched. */
function fakeProvider(input: {
  integrationKey: string
  capabilities?: readonly string[]
  connections: { id: string; displayName: string; health: ConnectionHealth }[]
  sources?: Record<string, { id: string; label: string }[]>
  optionSources?: readonly string[]
  throws?: boolean
}): ConnectionProvider {
  const { integrationKey, connections, sources = {}, optionSources = ['things'] } = input
  const boom = () => {
    throw new Error('integration unreachable')
  }
  const toSources = (connectionId: string): Source[] =>
    (sources[connectionId] ?? []).map((s) => ({
      id: s.id,
      connectionId,
      label: s.label,
      subscription: 'subscribed',
      health: 'ok',
    }))
  return {
    integrationKey,
    capabilities: input.capabilities ?? [`${integrationKey}_connected`],
    async listConnections(agencyId) {
      if (input.throws) boom()
      return connections.map<Connection>((c) => ({ ...c, integrationKey, agencyId }))
    },
    async listSources(_agencyId, connectionId) {
      if (input.throws) boom()
      return toSources(connectionId)
    },
    async options(_agencyId, connectionId, optionSource) {
      if (input.throws) boom()
      if (!optionSources.includes(optionSource)) return []
      return toSources(connectionId).map((s) => ({ id: s.id, label: s.label }))
    },
  }
}

/** Two connections of the SAME integration — acceptance criterion 1. */
const TWO_OF_ONE = fakeProvider({
  integrationKey: 'alpha',
  connections: [
    { id: 'alpha:1', displayName: 'החשבון הראשון', health: 'ok' },
    { id: 'alpha:2', displayName: 'החשבון השני', health: 'ok' },
  ],
  sources: {
    'alpha:1': [
      { id: 'src_a1', label: 'ערוץ א' },
      { id: 'src_a2', label: 'ערוץ ב' },
    ],
    'alpha:2': [{ id: 'src_b1', label: 'ערוץ ג' }],
  },
})

/** A completely different integration — acceptance criterion 2. */
const BRAND_NEW = fakeProvider({
  integrationKey: 'omega',
  capabilities: ['omega_connected'],
  connections: [{ id: 'omega:77', displayName: 'אומגה', health: 'ok' }],
  sources: { 'omega:77': [{ id: 'cal_9', label: 'יומן ראשי' }] },
  optionSources: ['calendars'],
})

describe('criterion 1 — two connections of one integration coexist', () => {
  it('both are listed, distinctly identified', async () => {
    const all = await listAllConnections([TWO_OF_ONE], 1)
    expect(all.map((c) => c.id)).toEqual(['alpha:1', 'alpha:2'])
    expect(new Set(all.map((c) => c.id)).size).toBe(2)
  })

  it('sources are scoped to the chosen connection, never merged', async () => {
    expect((await listSourcesFor([TWO_OF_ONE], 1, 'alpha:1')).map((s) => s.id)).toEqual(['src_a1', 'src_a2'])
    expect((await listSourcesFor([TWO_OF_ONE], 1, 'alpha:2')).map((s) => s.id)).toEqual(['src_b1'])
  })

  it('options for one connection never leak from the other', async () => {
    const one = await optionsFor([TWO_OF_ONE], 1, 'alpha:1', 'things')
    const two = await optionsFor([TWO_OF_ONE], 1, 'alpha:2', 'things')
    expect(one.map((o) => o.id)).toEqual(['src_a1', 'src_a2'])
    expect(two.map((o) => o.id)).toEqual(['src_b1'])
  })
})

describe('criterion 2 — a brand-new integration needs only its own module', () => {
  const providers = [TWO_OF_ONE, BRAND_NEW]

  it('registering it is the entire change: it lists, resolves and answers options', async () => {
    expect((await listAllConnections(providers, 1)).map((c) => c.id)).toEqual(['alpha:1', 'alpha:2', 'omega:77'])
    expect((await listSourcesFor(providers, 1, 'omega:77')).map((s) => s.id)).toEqual(['cal_9'])
    expect((await optionsFor(providers, 1, 'omega:77', 'calendars')).map((o) => o.id)).toEqual(['cal_9'])
  })

  it('routing is by connection id, so no caller learns which integration answered', () => {
    expect(providerForConnection(providers, 'omega:77')?.integrationKey).toBe('omega')
    expect(providerForConnection(providers, 'alpha:2')?.integrationKey).toBe('alpha')
    expect(providerForConnection(providers, 'unknown:1')).toBe(null)
  })

  it('its capability unlocks an event that requires it — with no code change to the runtime', async () => {
    const capabilities = await resolveCapabilities(providers, 1)
    const gated = {
      key: 'omega.booked',
      requirements: [{ type: 'connection', key: 'omega_connected' }],
      lifecycle: 'stable',
    } as unknown as EventDefinition
    const ctx: RequirementContext = { capabilities, entitlements: new Set(), flags: new Set() }
    expect(evaluateEvent(gated, ctx).state).toBe('available')
  })

  it('an unknown option source yields nothing rather than guessing', async () => {
    expect(await optionsFor(providers, 1, 'omega:77', 'products')).toEqual([])
  })
})

describe('criterion 3 — a disconnected connection is never silent', () => {
  const revoked = fakeProvider({
    integrationKey: 'alpha',
    connections: [{ id: 'alpha:1', displayName: 'החשבון הראשון', health: 'revoked' }],
  })

  it('an unhealthy connection is a problem the Builder must surface', async () => {
    expect(await connectionHealth([revoked], 1, 'alpha:1')).toBe('revoked')
    expect(isConnectionProblem('revoked')).toBe(true)
    expect(isConnectionProblem('needs_reauth')).toBe(true)
    expect(isConnectionProblem('degraded')).toBe(true)
    expect(isConnectionProblem('ok')).toBe(false)
  })

  it('a connection that has disappeared entirely is a problem, not an absence', async () => {
    const gone = fakeProvider({ integrationKey: 'alpha', connections: [] })
    expect(await connectionHealth([gone], 1, 'alpha:1')).toBe(null)
    expect(isConnectionProblem(null)).toBe(true)
  })

  it('an unhealthy connection does NOT grant its capability, so its events re-lock', async () => {
    const capabilities = await resolveCapabilities([revoked], 1)
    expect(capabilities.has('alpha_connected')).toBe(false)
  })

  it('one healthy connection is enough to grant the capability', async () => {
    const mixed = fakeProvider({
      integrationKey: 'alpha',
      connections: [
        { id: 'alpha:1', displayName: 'א', health: 'revoked' },
        { id: 'alpha:2', displayName: 'ב', health: 'ok' },
      ],
    })
    expect((await resolveCapabilities([mixed], 1)).has('alpha_connected')).toBe(true)
  })

  it('an integration that throws degrades to empty — it never crashes the Builder or fakes health', async () => {
    const broken = fakeProvider({ integrationKey: 'beta', connections: [], throws: true })
    expect(await listAllConnections([broken], 1)).toEqual([])
    expect(await listSourcesFor([broken], 1, 'beta:1')).toEqual([])
    expect(await optionsFor([broken], 1, 'beta:1', 'things')).toEqual([])
    expect((await resolveCapabilities([broken], 1)).size).toBe(0)
    expect(await connectionHealth([broken], 1, 'beta:1')).toBe(null)
  })

  it('a healthy provider still answers when another one is broken', async () => {
    const broken = fakeProvider({ integrationKey: 'beta', connections: [], throws: true })
    const all = await listAllConnections([broken, BRAND_NEW], 1)
    expect(all.map((c) => c.id)).toEqual(['omega:77'])
  })
})

describe('criterion 5 — stable ids, never labels', () => {
  it('option values are the source ids, and the labels are display only', async () => {
    const options = await optionsFor([TWO_OF_ONE], 1, 'alpha:1', 'things')
    expect(options.map((o) => o.id)).toEqual(['src_a1', 'src_a2'])
    // A label change must not change what is stored.
    expect(options.every((o) => o.id !== o.label)).toBe(true)
  })

  it('a renamed connection keeps its id, so bound automations survive a rename', async () => {
    const before = await listAllConnections([TWO_OF_ONE], 1)
    const renamed = fakeProvider({
      integrationKey: 'alpha',
      connections: [
        { id: 'alpha:1', displayName: 'שם חדש לגמרי', health: 'ok' },
        { id: 'alpha:2', displayName: 'גם כאן', health: 'ok' },
      ],
    })
    const after = await listAllConnections([renamed], 1)
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id))
    expect(after.map((c) => c.displayName)).not.toEqual(before.map((c) => c.displayName))
  })
})
