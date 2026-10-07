/**
 * Reading the Builder's state: the published questionnaire, the draft, the live
 * routing switches and which revisions live sessions are pinned to. Read-only.
 */
import { getChannelSettings, getMasterEnabled } from '@/db/autoResponseSettings'
import {
  QUESTIONNAIRE_CHANNEL,
  countActiveSessionsByRevision,
  getDraft,
  getLatestPublished,
  getPublished,
  listPublished,
} from '@/db/questionnaireRevisions'
import type { QuestionnaireDefinition } from '../definition'
import { toBuilder } from './convert'
import { describeQuestionnaire } from './view'
import { draftState } from './draftState'
import type { BuilderContext } from './service'

const asDefinition = (row: { definition: unknown }) => row.definition as QuestionnaireDefinition

export async function getBuilderState(ctx: BuilderContext) {
  const [latest, draft, settings, master, active] = await Promise.all([
    getLatestPublished(ctx.agencyId),
    getDraft(ctx.agencyId),
    getChannelSettings(ctx.agencyId, QUESTIONNAIRE_CHANNEL),
    getMasterEnabled(ctx.agencyId),
    countActiveSessionsByRevision(ctx.agencyId),
  ])
  return {
    published: latest
      ? {
          revision: latest.revision as number,
          publishedAt: latest.publishedAt as string,
          publishedBy: latest.publishedBy,
          source: latest.source,
          questionnaire: toBuilder(asDefinition(latest)),
          view: describeQuestionnaire(asDefinition(latest)),
        }
      : null,
    draft: draft ? { ...draftState(draft), outOfDate: (draft.baseRevision ?? null) !== (latest?.revision ?? null) } : null,
    live: {
      hasSettings: settings != null,
      routedToQuestionnaire: settings?.responder === 'questionnaire',
      channelEnabled: settings?.enabled === true,
      masterEnabled: master === true,
    },
    activeSessionsByRevision: active,
  }
}

export async function listRevisions(ctx: BuilderContext) {
  const [rows, active] = await Promise.all([listPublished(ctx.agencyId), countActiveSessionsByRevision(ctx.agencyId)])
  return rows.map((r) => ({
    revision: r.revision as number,
    publishedAt: r.publishedAt as string,
    publishedBy: r.publishedBy,
    source: r.source,
    activeSessions: active.find((a) => a.revision === r.revision)?.count ?? 0,
  }))
}

export async function getRevision(ctx: BuilderContext, revision: number) {
  const row = await getPublished(ctx.agencyId, revision)
  if (!row) return { ok: false as const, reason: 'revision_not_found' as const }
  return {
    ok: true as const,
    revision,
    publishedAt: row.publishedAt as string,
    source: row.source,
    questionnaire: toBuilder(asDefinition(row)),
    view: describeQuestionnaire(asDefinition(row)),
  }
}

