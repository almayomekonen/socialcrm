import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_OPENAI_MODEL, DEFAULT_IRE_OPENAI_MODEL, _resetAiEnvCacheForTests, getAiEnv } from '@/lib/ai/env'
import { getProviderChain, _resetProviderCacheForTests } from '@/lib/ai/providers'

/**
 * CRM Agent provider routing.
 *
 * The Agent leads with GPT-5.6 through its OWN variable. The point of these
 * tests is not that both surfaces currently name the same model — it is that
 * they are INDEPENDENT: retargeting the WhatsApp Qualifier must not move the
 * Agent, and vice versa. That independence is the whole reason the variable
 * exists, so it is asserted directly rather than implied.
 *
 * B5 uses chain[0] only, so for the Agent the head of the chain IS the routing
 * decision; the tail is asserted only where it proves nothing else regressed.
 */
describe('agent.investigate provider routing', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.AGENT_OPENAI_MODEL
    delete process.env.IRE_OPENAI_MODEL
    delete process.env.OPENAI_MODEL
    _resetAiEnvCacheForTests()
    _resetProviderCacheForTests()
  })

  function withKeys(over: Record<string, string> = {}) {
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    process.env.ANTHROPIC_API_KEY = 'sk-anthropic-test'
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'goog-test'
    Object.assign(process.env, over)
    _resetAiEnvCacheForTests()
    _resetProviderCacheForTests()
  }

  it('defaults the Agent model to gpt-5.6 without touching OPENAI_MODEL or the IRE model', () => {
    withKeys()
    const openai = getAiEnv().openai
    expect(openai?.agentModel).toBe(DEFAULT_AGENT_OPENAI_MODEL)
    expect(openai?.agentModel).toBe('gpt-5.6')
    expect(openai?.model).toBe('gpt-4.1-mini')
    expect(openai?.ireModel).toBe(DEFAULT_IRE_OPENAI_MODEL)
  })

  it('leads the Agent chain with OpenAI gpt-5.6', () => {
    withKeys()
    const chain = getProviderChain('primary', 'agent.investigate')
    expect(chain[0]?.provider).toBe('openai')
    expect(chain[0]?.modelId).toBe('gpt-5.6')
  })

  it('AGENT_OPENAI_MODEL retargets the Agent and leaves the IRE alone', () => {
    withKeys({ AGENT_OPENAI_MODEL: 'gpt-5.6-terra' })
    expect(getAiEnv().openai?.agentModel).toBe('gpt-5.6-terra')
    expect(getAiEnv().openai?.ireModel).toBe('gpt-5.6')
    expect(getProviderChain('primary', 'agent.investigate')[0]?.modelId).toBe('gpt-5.6-terra')
    expect(getProviderChain('primary', 'inbox.autoResponse')[0]?.modelId).toBe('gpt-5.6')
  })

  it('IRE_OPENAI_MODEL retargets the IRE and leaves the Agent alone', () => {
    withKeys({ IRE_OPENAI_MODEL: 'gpt-5.6-luna' })
    expect(getAiEnv().openai?.ireModel).toBe('gpt-5.6-luna')
    expect(getAiEnv().openai?.agentModel).toBe('gpt-5.6')
    expect(getProviderChain('primary', 'inbox.autoResponse')[0]?.modelId).toBe('gpt-5.6-luna')
    expect(getProviderChain('primary', 'agent.investigate')[0]?.modelId).toBe('gpt-5.6')
  })

  it('leaves a generic primary task Anthropic-first', () => {
    withKeys()
    const chain = getProviderChain('primary')
    expect(chain[0]?.provider).toBe('anthropic')
    expect(chain.some((h) => h.modelId === 'gpt-5.6')).toBe(false)
  })

  it('leaves a generic named task Anthropic-first', () => {
    withKeys()
    const chain = getProviderChain('primary', 'lead.askQuestion')
    expect(chain[0]?.provider).toBe('anthropic')
    expect(chain.some((h) => h.modelId === 'gpt-5.6')).toBe(false)
  })

  it('leaves the generic OpenAI fallback on OPENAI_MODEL, never the Agent model', () => {
    withKeys({ OPENAI_MODEL: 'gpt-4.1-mini' })
    const openaiHop = getProviderChain('primary').find((h) => h.provider === 'openai')
    expect(openaiHop?.modelId).toBe('gpt-4.1-mini')
  })

  it('degrades to the normal role order when OpenAI is unconfigured', () => {
    delete process.env.OPENAI_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-anthropic-test'
    _resetAiEnvCacheForTests()
    _resetProviderCacheForTests()

    const chain = getProviderChain('primary', 'agent.investigate')
    expect(chain.length).toBeGreaterThan(0)
    expect(chain[0]?.provider).toBe('anthropic')
    expect(chain.some((h) => h.provider === 'openai')).toBe(false)
  })

  it('returns an empty chain when no provider is configured at all', () => {
    _resetAiEnvCacheForTests()
    _resetProviderCacheForTests()
    expect(getProviderChain('primary', 'agent.investigate')).toEqual([])
  })
})
