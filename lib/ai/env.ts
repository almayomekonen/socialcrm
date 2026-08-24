export type IreReasoningEffort = 'low' | 'medium' | 'high'

export type AiEnv = {
  enabled: boolean
  agencyAllowlist: number[] | 'all'
  dailyUsdCap: number
  healthSecret: string | null
  anthropic: { apiKey: string; primaryModel: string; heavyModel: string } | null
  google: { apiKey: string; model: string } | null
  openai: { apiKey: string; model: string; ireModel: string; ireReasoningEffort: IreReasoningEffort } | null
  copilotEnabled: boolean
  copilotAgencyAllowlist: number[] | 'all'
  copilotPersistenceEnabled: boolean
  copilotInspectorEnabled: boolean
  generalModeAgencyAllowlist: number[] | 'all'
  reasonedGeneralAgencyAllowlist: number[] | 'all'
  synthesisAgencyAllowlist: number[] | 'all'
  runtimeCognitionAgencyAllowlist: number[] | 'all'
  agentAgencyAllowlist: number[] | 'all'
}

let cached: AiEnv | null = null

export const DEFAULT_IRE_OPENAI_MODEL = 'gpt-5.6'
export const DEFAULT_IRE_REASONING_EFFORT: IreReasoningEffort = 'high'

function parseIreReasoningEffort(raw: string | undefined): IreReasoningEffort {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'low' || v === 'medium' || v === 'high') return v
  return DEFAULT_IRE_REASONING_EFFORT
}

function parseAgencyAllowlist(raw: string | undefined): number[] | 'all' {
  if (!raw) return []
  const trimmed = raw.trim()
  if (trimmed === '*' || trimmed.toLowerCase() === 'all') return 'all'
  return trimmed
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function loadEnv(): AiEnv {
  const enabled = process.env.AI_ENABLED === 'true' || process.env.AI_ENABLED === '1'
  const copilotEnabled = process.env.AI_COPILOT_ENABLED === 'true' || process.env.AI_COPILOT_ENABLED === '1'
  const copilotPersistenceEnabled = process.env.AI_COPILOT_PERSIST === 'true' || process.env.AI_COPILOT_PERSIST === '1'
  const copilotInspectorEnabled = process.env.AI_COPILOT_INSPECTOR === 'true' || process.env.AI_COPILOT_INSPECTOR === '1'

  const dailyUsdCap = Number(process.env.AI_DAILY_USD_CAP)
  const cap = Number.isFinite(dailyUsdCap) && dailyUsdCap > 0 ? dailyUsdCap : 20

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || ''
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || ''
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || ''

  return {
    enabled,
    copilotEnabled,
    copilotPersistenceEnabled,
    copilotInspectorEnabled,
    copilotAgencyAllowlist: parseAgencyAllowlist(process.env.AI_COPILOT_AGENCY_ALLOWLIST),
    generalModeAgencyAllowlist: parseAgencyAllowlist(process.env.GENERAL_MODE_AGENCY_IDS),
    reasonedGeneralAgencyAllowlist: parseAgencyAllowlist(process.env.REASONED_GENERAL_AGENCY_IDS),
    synthesisAgencyAllowlist: parseAgencyAllowlist(process.env.SYNTHESIS_AGENCY_IDS),
    runtimeCognitionAgencyAllowlist: parseAgencyAllowlist(process.env.RUNTIME_COGNITION_AGENCY_IDS),
    agentAgencyAllowlist: parseAgencyAllowlist(process.env.AGENT_AGENCY_IDS),
    agencyAllowlist: parseAgencyAllowlist(process.env.AI_AGENCY_ALLOWLIST),
    dailyUsdCap: cap,
    healthSecret: process.env.AI_HEALTH_SECRET?.trim() || null,
    anthropic: anthropicKey
      ? {
          apiKey: anthropicKey,
          primaryModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6',
          heavyModel: process.env.ANTHROPIC_HEAVY_MODEL?.trim() || 'claude-opus-4-7',
        }
      : null,
    google: googleKey
      ? {
          apiKey: googleKey,
          model: process.env.GOOGLE_AI_MODEL?.trim() || 'gemini-2.5-flash-lite',
        }
      : null,
    openai: openaiKey
      ? {
          apiKey: openaiKey,
          model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
          ireModel: process.env.IRE_OPENAI_MODEL?.trim() || DEFAULT_IRE_OPENAI_MODEL,
          ireReasoningEffort: parseIreReasoningEffort(process.env.IRE_OPENAI_REASONING_EFFORT),
        }
      : null,
  }
}

export function getAiEnv(): AiEnv {
  if (!cached) cached = loadEnv()
  return cached
}

export function _resetAiEnvCacheForTests() {
  cached = null
}
