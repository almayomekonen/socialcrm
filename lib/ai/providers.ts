import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { getAiEnv } from './env'
import { ModelRole, ProviderName } from './types'

export type ResolvedModel = {
  provider: ProviderName
  modelId: string
  model: LanguageModel
}

let anthropicProvider: ReturnType<typeof createAnthropic> | null | undefined
let googleProvider: ReturnType<typeof createGoogleGenerativeAI> | null | undefined
let openaiProvider: ReturnType<typeof createOpenAI> | null | undefined

function getAnthropic() {
  if (anthropicProvider !== undefined) return anthropicProvider
  const env = getAiEnv()
  anthropicProvider = env.anthropic ? createAnthropic({ apiKey: env.anthropic.apiKey }) : null
  return anthropicProvider
}

function getGoogle() {
  if (googleProvider !== undefined) return googleProvider
  const env = getAiEnv()
  googleProvider = env.google ? createGoogleGenerativeAI({ apiKey: env.google.apiKey }) : null
  return googleProvider
}

function getOpenAI() {
  if (openaiProvider !== undefined) return openaiProvider
  const env = getAiEnv()
  openaiProvider = env.openai ? createOpenAI({ apiKey: env.openai.apiKey }) : null
  return openaiProvider
}

export function getModel(role: ModelRole): ResolvedModel | null {
  const env = getAiEnv()

  switch (role) {
    case 'primary': {
      const a = getAnthropic()
      if (a && env.anthropic) {
        return { provider: 'anthropic', modelId: env.anthropic.primaryModel, model: a(env.anthropic.primaryModel) }
      }
      return getModel('volume')
    }
    case 'volume': {
      const g = getGoogle()
      if (g && env.google) {
        return { provider: 'google', modelId: env.google.model, model: g(env.google.model) }
      }
      return getModel('fallback')
    }
    case 'heavy': {
      const a = getAnthropic()
      if (a && env.anthropic) {
        return { provider: 'anthropic', modelId: env.anthropic.heavyModel, model: a(env.anthropic.heavyModel) }
      }
      return getModel('primary')
    }
    case 'fallback': {
      const o = getOpenAI()
      if (o && env.openai) {
        return { provider: 'openai', modelId: env.openai.model, model: o(env.openai.model) }
      }
      return null
    }
  }
}

export function getProviderChain(role: ModelRole): ResolvedModel[] {
  const seen = new Set<ProviderName>()
  const chain: ResolvedModel[] = []
  const order: ModelRole[] = role === 'heavy' ? ['heavy', 'primary', 'volume', 'fallback'] : [role, 'volume', 'fallback']
  for (const r of order) {
    const m = getModel(r)
    if (m && !seen.has(m.provider)) {
      seen.add(m.provider)
      chain.push(m)
    }
  }
  return chain
}

export function _resetProviderCacheForTests() {
  anthropicProvider = undefined
  googleProvider = undefined
  openaiProvider = undefined
}
