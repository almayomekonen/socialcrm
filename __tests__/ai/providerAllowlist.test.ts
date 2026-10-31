import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetAiEnvCacheForTests, getAiEnv, parseProviderAllowlist } from '@/lib/ai/env'
import { getOpenAIProvider, getProviderChain, _resetProviderCacheForTests } from '@/lib/ai/providers'
import { hasAnyProviderConfigured } from '@/lib/ai/flags'
import { admitAiRun } from '@/lib/ai/gate'
import { getTaskConfig } from '@/lib/ai/tasks'
import type { ModelRole, TaskKind } from '@/lib/ai/types'

/**
 * AI_PROVIDERS — the explicit provider allowlist. Every chain type (primary,
 * volume, heavy, the OpenAI-led Agent and auto-reply) and every task kind is
 * checked with the allowlist unset (unchanged behaviour), set to openai, set
 * to other combinations, and set to invalid values (fails closed). All three
 * keys stay configured throughout: the allowlist, not key removal, decides.
 */
const ALL_KINDS: TaskKind[] = [
  'lead.summary',
  'lead.classify',
  'lead.followup',
  'lead.nextStep',
  'lead.askQuestion',
  'pipeline.weekly',
  'health.check',
  'copilot.classifyIntent',
  'copilot.generalReason',
  'conversation.analysis',
  'inbox.autoResponse',
  'agent.investigate',
]
const KEYS = {
  OPENAI_API_KEY: 'sk-openai-test',
  ANTHROPIC_API_KEY: 'sk-anthropic-test',
  GOOGLE_GENERATIVE_AI_API_KEY: 'goog-test',
}
const VARS = [...Object.keys(KEYS), 'AI_PROVIDERS', 'AI_ENABLED', 'AI_AGENCY_ALLOWLIST']

function setup(providers?: string) {
  Object.assign(process.env, KEYS)
  if (providers === undefined) delete process.env.AI_PROVIDERS
  else process.env.AI_PROVIDERS = providers
  _resetAiEnvCacheForTests()
  _resetProviderCacheForTests()
}
const chainOf = (kind: TaskKind) => getProviderChain(getTaskConfig(kind).role, kind)
const providersOf = (role: ModelRole, kind?: TaskKind) => getProviderChain(role, kind).map((m) => `${m.provider}:${m.modelId}`)

afterEach(() => {
  for (const k of VARS) delete process.env[k]
  _resetAiEnvCacheForTests()
  _resetProviderCacheForTests()
  vi.restoreAllMocks()
})

describe('parseProviderAllowlist', () => {
  it('unset or blank means every configured provider (the previous behaviour)', () => {
    expect(parseProviderAllowlist(undefined).allowed).toBe('all')
    expect(parseProviderAllowlist('').allowed).toBe('all')
    expect(parseProviderAllowlist('   ').allowed).toBe('all')
  })

  it('accepts names case-insensitively, comma or whitespace separated, de-duplicated', () => {
    expect([...(parseProviderAllowlist(' OpenAI ').allowed as Set<string>)]).toEqual(['openai'])
    expect([...(parseProviderAllowlist('openai, anthropic openai').allowed as Set<string>)]).toEqual(['openai', 'anthropic'])
  })

  it('unknown names are reported and enable nothing', () => {
    expect(parseProviderAllowlist('opnai')).toEqual({ allowed: new Set(), unknown: ['opnai'] })
    expect(parseProviderAllowlist('openai,foo,internal')).toEqual({ allowed: new Set(['openai']), unknown: ['foo', 'internal'] })
  })
})

describe('AI_PROVIDERS unset — the existing provider behaviour is preserved', () => {
  it('primary, volume and heavy chains are unchanged', () => {
    setup()
    expect(providersOf('primary')).toEqual(['anthropic:claude-sonnet-4-6', 'google:gemini-2.5-flash-lite', 'openai:gpt-4.1-mini'])
    expect(providersOf('volume')).toEqual(['google:gemini-2.5-flash-lite', 'openai:gpt-4.1-mini'])
    expect(providersOf('heavy')).toEqual(['anthropic:claude-opus-4-7', 'google:gemini-2.5-flash-lite', 'openai:gpt-4.1-mini'])
  })

  it('the Agent and auto-reply still lead with OpenAI gpt-5.6, then fall back as before', () => {
    setup()
    for (const kind of ['agent.investigate', 'inbox.autoResponse'] as const) {
      expect(chainOf(kind).map((m) => m.provider)).toEqual(['openai', 'anthropic', 'google'])
      expect(chainOf(kind)[0].modelId).toBe('gpt-5.6')
    }
  })
})

describe('AI_PROVIDERS=openai — OpenAI is the only provider anywhere', () => {
  it('every task kind’s chain contains only OpenAI, with the existing OpenAI models', () => {
    setup('openai')
    for (const kind of ALL_KINDS) {
      const chain = chainOf(kind)
      expect(chain.length, kind).toBeGreaterThan(0)
      expect(
        chain.every((m) => m.provider === 'openai'),
        kind,
      ).toBe(true)
    }
    expect(chainOf('lead.summary').map((m) => m.modelId)).toEqual(['gpt-4.1-mini']) // primary
    expect(chainOf('conversation.analysis').map((m) => m.modelId)).toEqual(['gpt-4.1-mini']) // volume
    expect(chainOf('pipeline.weekly').map((m) => m.modelId)).toEqual(['gpt-4.1-mini']) // heavy
    expect(chainOf('agent.investigate').map((m) => m.modelId)).toEqual(['gpt-5.6'])
    expect(chainOf('inbox.autoResponse').map((m) => m.modelId)).toEqual(['gpt-5.6'])
  })

  it('every role, with or without a task kind, resolves to OpenAI only', () => {
    setup('openai')
    for (const role of ['primary', 'volume', 'heavy', 'fallback'] as ModelRole[]) {
      expect(providersOf(role)).toEqual(['openai:gpt-4.1-mini'])
    }
  })

  it('the Anthropic and Google keys stay stored but are not configured', () => {
    setup('openai')
    expect(process.env.ANTHROPIC_API_KEY).toBe(KEYS.ANTHROPIC_API_KEY)
    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe(KEYS.GOOGLE_GENERATIVE_AI_API_KEY)
    expect(getAiEnv().anthropic).toBeNull()
    expect(getAiEnv().google).toBeNull()
    expect(getAiEnv().openai).toMatchObject({ model: 'gpt-4.1-mini', ireModel: 'gpt-5.6', agentModel: 'gpt-5.6' })
  })

  it('transcription (OpenAI) is still available', () => {
    setup('openai')
    expect(getOpenAIProvider()).not.toBeNull()
    expect(hasAnyProviderConfigured()).toBe(true)
  })

  it('the real gate admits with an OpenAI-only chain', async () => {
    setup('openai')
    process.env.AI_ENABLED = '1'
    process.env.AI_AGENCY_ALLOWLIST = 'all'
    _resetAiEnvCacheForTests()
    const res = await admitAiRun({ kind: 'health.check', bypassAllowlist: true })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.chain.map((m) => m.provider)).toEqual(['openai'])
  })
})

describe('other allowlists', () => {
  it('a subset keeps the configured order among the allowed providers', () => {
    setup('openai,anthropic')
    expect(providersOf('primary')).toEqual(['anthropic:claude-sonnet-4-6', 'openai:gpt-4.1-mini'])
    expect(providersOf('volume')).toEqual(['openai:gpt-4.1-mini']) // google excluded
  })

  it('without OpenAI, the Agent and auto-reply lose their OpenAI lead and transcription is unavailable', () => {
    setup('anthropic')
    expect(chainOf('agent.investigate').map((m) => m.provider)).toEqual(['anthropic'])
    expect(chainOf('inbox.autoResponse').map((m) => m.provider)).toEqual(['anthropic'])
    expect(getOpenAIProvider()).toBeNull()
  })
})

describe('invalid values fail closed', () => {
  it('a typo allows NO provider: every chain is empty and the gate reports no-providers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setup('opnai')
    process.env.AI_ENABLED = '1'
    process.env.AI_AGENCY_ALLOWLIST = 'all'
    _resetAiEnvCacheForTests()
    for (const kind of ALL_KINDS) expect(chainOf(kind), kind).toEqual([])
    expect(hasAnyProviderConfigured()).toBe(false)
    expect(getOpenAIProvider()).toBeNull()
    expect(await admitAiRun({ kind: 'health.check', bypassAllowlist: true })).toEqual({ ok: false, reason: 'no-providers' })
    expect(warn).toHaveBeenCalledWith('[ai] AI_PROVIDERS: ignoring unknown provider name(s)', ['opnai'])
  })

  it('an unknown name next to a valid one is ignored and reported, never widened to all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setup('openai,gemini')
    expect(providersOf('primary')).toEqual(['openai:gpt-4.1-mini'])
    expect(warn).toHaveBeenCalledWith('[ai] AI_PROVIDERS: ignoring unknown provider name(s)', ['gemini'])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sk-') // names only, never a key
  })
})
