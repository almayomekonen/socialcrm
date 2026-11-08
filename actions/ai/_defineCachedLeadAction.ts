import { unstable_cache } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { runStructured } from '@/lib/ai/router'
import type { FlexibleSchema } from 'ai'
import { getFullLead } from '@/db/clients'
import { LeadIntelligenceInputs, getLeadIntelligenceInputs } from '@/db/aiSummaries'
import type { AiRunResult, TaskKind } from '@/lib/ai/types'
import { persistAssistantTurn } from '@/lib/copilot/persistConversation'
import { getTaskConfig } from '@/lib/ai/tasks'
import { runCopilotRequest } from '@/lib/credits/copilotRequest'

class AiNonCacheableError<T> extends Error {
  constructor(public result: AiRunResult<T>) {
    super('ai-non-cacheable')
    this.name = 'AiNonCacheableError'
  }
}

type SanitizationReport = { polluted: boolean; fields: string[]; sample?: string }

export type CachedLeadActionConfig<T> = {
  kind: TaskKind
  schema: FlexibleSchema<unknown>
  schemaName: string
  schemaDescription: string
  system: string
  buildUserMessage: (args: { inputs: LeadIntelligenceInputs; leadName: string | null }) => string
  sanitize: (out: T) => { result: T | null; report: SanitizationReport }
  cache: {
    keyPrefix: string
    ttlSeconds: number
    tags: (leadId: number) => string[]
  }
  requiresLeadName: boolean
  pollutionLogPrefix: string
  /** A Copilot button the user pressed: one request against the allowance (a cached answer settles as void). */
  countsAsCopilotRequest?: boolean
  persist?: {
    actionId: string
    userText: string
    synopsisOf?: (result: T) => string
  }
}

type RunArgs = {
  leadId: number
  agencyId: number
  userId: number
  inputs: LeadIntelligenceInputs
  leadName: string | null
}

export function defineCachedLeadAction<T>(config: CachedLeadActionConfig<T>) {
  const cacheByLead = new Map<number, (args: RunArgs) => Promise<AiRunResult<T>>>()

  async function runInner(args: RunArgs): Promise<AiRunResult<T>> {
    const userMessage = config.buildUserMessage({ inputs: args.inputs, leadName: args.leadName })
    const startedAt = new Date()
    const out = await runStructured({
      kind: config.kind,
      schema: config.schema,
      schemaName: config.schemaName,
      schemaDescription: config.schemaDescription,
      system: config.system,
      user: userMessage,
      leadId: args.leadId,
      agencyId: args.agencyId,
    })

    if (out.ok === false) {
      if (config.persist) {
        await persistAssistantTurn({
          agencyId: args.agencyId,
          leadId: args.leadId,
          userId: args.userId,
          taskKind: config.kind,
          role: getTaskConfig(config.kind).role,
          mode: null,
          actionId: config.persist.actionId,
          userText: config.persist.userText,
          markerRole: 'system',
          result: out,
          startedAt,
        })
      }
      throw new AiNonCacheableError(out)
    }

    const { result, report } = config.sanitize(out.data as T)
    if (report.polluted) {
      console.warn(
        `[ai] ${config.pollutionLogPrefix}.pollution leadId=${args.leadId} fields=${report.fields.join(',')} sample=${report.sample}`,
      )
    }
    if (!result) {
      const sanitizerFailure: AiRunResult<T> = {
        ok: false,
        reason: 'invalid-input',
        message: 'sanitizer-rejected-output',
      }
      if (config.persist) {
        await persistAssistantTurn({
          agencyId: args.agencyId,
          leadId: args.leadId,
          userId: args.userId,
          taskKind: config.kind,
          role: getTaskConfig(config.kind).role,
          mode: null,
          actionId: config.persist.actionId,
          userText: config.persist.userText,
          result: sanitizerFailure,
          startedAt,
        })
      }
      throw new AiNonCacheableError<T>(sanitizerFailure)
    }

    if (config.persist) {
      await persistAssistantTurn<T>({
        agencyId: args.agencyId,
        leadId: args.leadId,
        userId: args.userId,
        taskKind: config.kind,
        role: getTaskConfig(config.kind).role,
        mode: null,
        actionId: config.persist.actionId,
        userText: config.persist.userText,
        markerRole: 'system',
        structuredPayload: { actionId: config.persist.actionId, data: result },
        assistantSynopsis: config.persist.synopsisOf ? config.persist.synopsisOf(result) : '',
        result: { ...out, data: result },
        startedAt,
      })
    }

    return { ...out, data: result }
  }

  function getCacheForLead(leadId: number) {
    let c = cacheByLead.get(leadId)
    if (!c) {
      c = unstable_cache(runInner, ['ai', config.cache.keyPrefix, String(leadId)], {
        revalidate: config.cache.ttlSeconds,
        tags: config.cache.tags(leadId),
      }) as (args: RunArgs) => Promise<AiRunResult<T>>
      cacheByLead.set(leadId, c)
    }
    return c
  }

  return async function dispatch(leadIdRaw: number | string): Promise<AiRunResult<T>> {
    const leadId = Number(leadIdRaw)
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return { ok: false, reason: 'invalid-input' }
    }

    const user = await requireAgencyUser()

    const [snapshot, leadMeta] = await Promise.all([
      getLeadIntelligenceInputs(leadId).catch(() => null),
      config.requiresLeadName ? getFullLead({ id: leadId, select: ['name'] }).catch(() => null) : Promise.resolve(null),
    ])
    if (!snapshot) return { ok: false, reason: 'invalid-input' }
    if (config.requiresLeadName && !leadMeta?.name) return { ok: false, reason: 'invalid-input' }

    const args: RunArgs = {
      leadId,
      agencyId: user.agencyId,
      userId: user.id,
      inputs: snapshot.inputs,
      leadName: (leadMeta?.name as string | undefined) ?? null,
    }

    const generate = async (): Promise<AiRunResult<T>> => {
      try {
        return await getCacheForLead(leadId)(args)
      } catch (err) {
        if (err instanceof AiNonCacheableError) return err.result as AiRunResult<T>
        throw err
      }
    }
    return config.countsAsCopilotRequest ? runCopilotRequest<AiRunResult<T>>(user, () => ({ ok: false, reason: 'ai-credits-exhausted' }), generate) : generate()
  }
}
