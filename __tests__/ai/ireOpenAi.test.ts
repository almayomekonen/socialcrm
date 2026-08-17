import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_IRE_OPENAI_MODEL, _resetAiEnvCacheForTests, getAiEnv } from '@/lib/ai/env'
import { getProviderChain, _resetProviderCacheForTests } from '@/lib/ai/providers'
import { estimateCostUsd, getTaskConfig } from '@/lib/ai/tasks'

describe('IRE OpenAI model config', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.IRE_OPENAI_MODEL
    delete process.env.IRE_OPENAI_REASONING_EFFORT
    delete process.env.OPENAI_MODEL
    _resetAiEnvCacheForTests()
    _resetProviderCacheForTests()
  })

  it('defaults IRE model to gpt-5.6 and reasoning high without changing OPENAI_MODEL', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    _resetAiEnvCacheForTests()
    const openai = getAiEnv().openai
    expect(openai?.model).toBe('gpt-4.1-mini')
    expect(openai?.ireModel).toBe(DEFAULT_IRE_OPENAI_MODEL)
    expect(openai?.ireModel).toBe('gpt-5.6')
    expect(openai?.ireReasoningEffort).toBe('high')
  })

  it('IRE_OPENAI_MODEL switches the IRE alias without changing application logic', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.IRE_OPENAI_MODEL = 'gpt-5.6-terra'
    process.env.IRE_OPENAI_REASONING_EFFORT = 'medium'
    _resetAiEnvCacheForTests()
    const openai = getAiEnv().openai
    expect(openai?.ireModel).toBe('gpt-5.6-terra')
    expect(openai?.ireReasoningEffort).toBe('medium')
    expect(openai?.model).toBe('gpt-4.1-mini')
  })

  it('inbox.autoResponse provider chain starts with the IRE OpenAI model', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.IRE_OPENAI_MODEL = 'gpt-5.6'
    _resetAiEnvCacheForTests()
    _resetProviderCacheForTests()
    const chain = getProviderChain('primary', 'inbox.autoResponse')
    expect(chain[0]?.provider).toBe('openai')
    expect(chain[0]?.modelId).toBe('gpt-5.6')
    expect(getProviderChain('primary').some((h) => h.modelId === 'gpt-5.6')).toBe(false)
  })

  it('prices gpt-5.6 Sol above gpt-4.1-mini', () => {
    const mini = estimateCostUsd('gpt-4.1-mini', 2500, 150)
    const sol = estimateCostUsd('gpt-5.6', 2500, 150)
    expect(sol).toBeGreaterThan(mini)
    expect(getTaskConfig('inbox.autoResponse').timeoutMs).toBeGreaterThanOrEqual(45_000)
  })
})
