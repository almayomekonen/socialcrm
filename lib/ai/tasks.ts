import { ModelRole, TaskKind } from './types'

export type TaskConfig = {
  role: ModelRole
  maxOutputTokens: number
  timeoutMs: number
  retryOnSameProvider: number
}

const TASKS: Record<TaskKind, TaskConfig> = {
  'lead.summary': {
    role: 'primary',
    maxOutputTokens: 600,
    timeoutMs: 8_000,
    retryOnSameProvider: 1,
  },
  'lead.classify': {
    role: 'volume',
    maxOutputTokens: 200,
    timeoutMs: 6_000,
    retryOnSameProvider: 1,
  },

  'lead.followup': {
    role: 'primary',
    maxOutputTokens: 700,
    timeoutMs: 9_000,
    retryOnSameProvider: 1,
  },

  'lead.nextStep': {
    role: 'primary',
    maxOutputTokens: 400,
    timeoutMs: 8_000,
    retryOnSameProvider: 1,
  },
  'lead.askQuestion': {
    role: 'primary',
    maxOutputTokens: 900,
    timeoutMs: 18_000,
    retryOnSameProvider: 1,
  },
  'pipeline.weekly': {
    role: 'heavy',
    maxOutputTokens: 4_000,
    timeoutMs: 30_000,
    retryOnSameProvider: 0,
  },
  'health.check': {
    role: 'primary',
    maxOutputTokens: 16,
    timeoutMs: 4_000,
    retryOnSameProvider: 0,
  },
  'copilot.classifyIntent': {
    role: 'volume',
    maxOutputTokens: 80,
    timeoutMs: 3_000,
    retryOnSameProvider: 0,
  },
}

export function getTaskConfig(kind: TaskKind): TaskConfig {
  return TASKS[kind]
}

type Pricing = { inUsdPerM: number; outUsdPerM: number }

const PRICING: Record<string, Pricing> = {
  // Anthropic
  'claude-opus-4-7': { inUsdPerM: 5, outUsdPerM: 25 },
  'claude-sonnet-4-6': { inUsdPerM: 3, outUsdPerM: 15 },
  'claude-haiku-4-5': { inUsdPerM: 1, outUsdPerM: 5 },
  // Google
  'gemini-2.5-flash-lite': { inUsdPerM: 0.1, outUsdPerM: 0.4 },
  'gemini-2.5-flash': { inUsdPerM: 0.3, outUsdPerM: 2.5 },
  'gemini-2.5-pro': { inUsdPerM: 1.25, outUsdPerM: 10 },
  // OpenAI fallback
  'gpt-4.1-mini': { inUsdPerM: 0.4, outUsdPerM: 1.6 },
  'gpt-4.1': { inUsdPerM: 2, outUsdPerM: 8 },
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? { inUsdPerM: 5, outUsdPerM: 15 }
  return (inputTokens * p.inUsdPerM + outputTokens * p.outUsdPerM) / 1_000_000
}
