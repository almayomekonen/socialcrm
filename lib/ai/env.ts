export type IreReasoningEffort = 'low' | 'medium' | 'high'

export type AiEnv = {
  enabled: boolean
  agencyAllowlist: number[] | 'all'
  dailyUsdCap: number
  healthSecret: string | null
  anthropic: { apiKey: string; primaryModel: string; heavyModel: string } | null
  google: { apiKey: string; model: string } | null
  openai: {
    apiKey: string
    model: string
    ireModel: string
    agentModel: string
    ireReasoningEffort: IreReasoningEffort
  } | null
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

/**
 * The CRM Agent's model, deliberately its OWN variable rather than a reuse of
 * IRE_OPENAI_MODEL. The two surfaces happen to want the same model today, but
 * they are unrelated products with unrelated tuning: retargeting the WhatsApp
 * Qualifier must never silently retarget the Agent, and vice versa. The default
 * matches the IRE's only because that is the current flagship, not because they
 * are linked.
 */
export const DEFAULT_AGENT_OPENAI_MODEL = 'gpt-5.6'
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

/** Model providers the AI_PROVIDERS allowlist can name. */
export const ALLOWLISTABLE_PROVIDERS = ['openai', 'anthropic', 'google'] as const
export type AllowlistableProvider = (typeof ALLOWLISTABLE_PROVIDERS)[number]

/**
 * AI_PROVIDERS — an explicit provider allowlist, e.g. `openai` or
 * `openai,anthropic` (comma or whitespace separated, case-insensitive).
 *
 *   unset or empty   every provider whose API key is set may be used (the
 *                    behaviour before this variable existed);
 *   set              ONLY the named providers may be used. A provider that is
 *                    not named is treated exactly as if its key were absent,
 *                    so it enters no chain, no lead model and no other AI
 *                    surface. Its key stays stored and untouched.
 *
 * FAILS CLOSED. An unknown name never enables anything: it is ignored and
 * reported. If no valid name remains (e.g. a typo such as `opnai`), NO
 * provider is allowed and every AI task reports `no-providers` — rather than
 * silently falling back to all providers.
 */
export function parseProviderAllowlist(raw: string | undefined): {
  allowed: ReadonlySet<AllowlistableProvider> | 'all'
  unknown: string[]
} {
  const tokens = (raw ?? '')
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (!tokens.length) return { allowed: 'all', unknown: [] }
  const known = new Set<string>(ALLOWLISTABLE_PROVIDERS)
  return {
    allowed: new Set(tokens.filter((t): t is AllowlistableProvider => known.has(t))),
    unknown: [...new Set(tokens.filter((t) => !known.has(t)))],
  }
}

function loadEnv(): AiEnv {
  const providers = parseProviderAllowlist(process.env.AI_PROVIDERS)
  if (providers.unknown.length) {
    // Names only; never a key. An unknown name enables nothing.
    console.warn(
      '[ai] AI_PROVIDERS: ignoring unknown provider name(s)',
      providers.unknown.map((n) => n.slice(0, 32)),
    )
  }
  const permitted = (p: AllowlistableProvider) => providers.allowed === 'all' || providers.allowed.has(p)

  const enabled = process.env.AI_ENABLED === 'true' || process.env.AI_ENABLED === '1'
  const copilotEnabled = process.env.AI_COPILOT_ENABLED === 'true' || process.env.AI_COPILOT_ENABLED === '1'
  const copilotPersistenceEnabled = process.env.AI_COPILOT_PERSIST === 'true' || process.env.AI_COPILOT_PERSIST === '1'
  const copilotInspectorEnabled = process.env.AI_COPILOT_INSPECTOR === 'true' || process.env.AI_COPILOT_INSPECTOR === '1'

  const dailyUsdCap = Number(process.env.AI_DAILY_USD_CAP)
  const cap = Number.isFinite(dailyUsdCap) && dailyUsdCap > 0 ? dailyUsdCap : 20

  // A provider outside AI_PROVIDERS is treated as unconfigured; its key stays stored and unused.
  const anthropicKey = permitted('anthropic') ? process.env.ANTHROPIC_API_KEY?.trim() || '' : ''
  const googleKey = permitted('google') ? process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || '' : ''
  const openaiKey = permitted('openai') ? process.env.OPENAI_API_KEY?.trim() || '' : ''

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
          agentModel: process.env.AGENT_OPENAI_MODEL?.trim() || DEFAULT_AGENT_OPENAI_MODEL,
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
