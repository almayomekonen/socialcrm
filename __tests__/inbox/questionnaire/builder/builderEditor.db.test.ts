import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'

/**
 * Questionnaire Builder PR2 against a real database: what the conversation
 * editor relies on beyond PR1. Browser refs resolved by the real save, ids
 * handed back, the clean first-run opening, publisher names in the history,
 * and restore = copy into a draft → publish as a NEW revision.
 *
 * Authentication is the only thing faked.
 */

const auth = vi.hoisted(() => ({ user: null as null | { id: number; agencyId: number; role: string } }))
vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess: async () => auth.user,
  requireAgencyUser: async () => auth.user,
}))

import { discardQuestionnaireDraft, openQuestionnaireDraft, saveQuestionnaireDraft } from '@/actions/questionnaire/builderDraft'
import {
  listQuestionnaireRevisions,
  publishQuestionnaireDraft,
  simulateQuestionnaireDraft,
} from '@/actions/questionnaire/builderPublish'
import { adoptIds, enableOther, keyOf, otherOf } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { hasCustomerFacingDash } from '@/lib/inbox/autoresponse/customerFacingText'

const PP = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8'))
const migration = require(path.join(process.cwd(), 'migrations/20261006120000_questionnaire_revisions.cjs'))

const agencies: number[] = []
type Tenant = { agencyId: number; adminId: number }

async function makeAgency(name: string, questionnaire: unknown | null): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name, autoResponseEnabled: true, plan: 'pro' }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [admin] = await db('users').insert({ firstName: 'דנה', lastName: 'כהן', role: 'ADMIN', agencyId }).returning('id')
  if (questionnaire) {
    await db('auto_response_settings').insert({
      agencyId,
      channel: 'whatsapp',
      enabled: true,
      mode: 'acknowledge',
      replyMode: 'ai',
      responder: 'questionnaire',
      questionnaire: JSON.stringify(questionnaire),
    })
    await migration.up(db) // the backfill, as for agencies that existed when it ran
  }
  auth.user = { id: Number(admin.id), agencyId, role: 'ADMIN' }
  return { agencyId, adminId: Number(admin.id) }
}

beforeAll(() => {
  process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = 'all'
})
afterAll(async () => {
  delete process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL questionnaire.allow_purge = 'on'`)
    await trx('questionnaire_revisions').whereIn('agencyId', agencies).del()
  })
  await db('analytics_events').whereIn('agencyId', agencies).del()
  await db('auto_response_settings').whereIn('agencyId', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('the editor against the real save', () => {
  it('"אחר" + follow-up created together are saved with fresh ids, conditions resolved, ids handed back', async () => {
    const t = await makeAgency('pr2-salon', null)
    const opened = await openQuestionnaireDraft()
    if (opened.ok === false) throw new Error(JSON.stringify(opened))
    const first = opened.questionnaire.questions[0]
    const named = {
      ...opened.questionnaire,
      questions: [
        {
          ...first,
          answer: {
            kind: 'single_choice' as const,
            options: (first.answer as { options: Array<{ id?: string; label: string; phrasings: string[] }> }).options.map(
              (o, i) => ({ ...o, label: ['תספורת', 'צבע'][i] }),
            ),
          },
        },
      ],
    }
    const edited = enableOther(named, keyOf(first))
    const saved = await saveQuestionnaireDraft({ draftId: opened.draftId, expectedVersion: 1, questionnaire: edited })
    if (saved.ok === false) throw new Error(JSON.stringify(saved))
    expect(saved.ready).toBe(true)

    const other = otherOf(edited, keyOf(first))!
    const optionId = saved.assigned[other.option.ref!]
    const followUpId = saved.assigned[other.followUp!.ref!]
    expect(optionId).toMatch(/^o_/)
    expect(followUpId).toMatch(/^q_/)

    const stored = await db('questionnaire_revisions').where({ id: opened.draftId }).first()
    const steps = stored.definition.steps
    expect(steps[1]).toMatchObject({ id: followUpId, when: { step: first.id, anyOf: [optionId] } })
    expect(JSON.stringify(stored.definition)).not.toContain('new_')

    // The editor adopts the ids; saving again changes nothing and assigns nothing.
    const again = await saveQuestionnaireDraft({
      draftId: opened.draftId,
      expectedVersion: 2,
      questionnaire: adoptIds(edited, saved.assigned),
    })
    if (again.ok === false) throw new Error(JSON.stringify(again))
    expect(again.assigned).toEqual({})
    expect((await db('questionnaire_revisions').where({ id: opened.draftId }).first()).definition).toEqual(stored.definition)

    // The explanation names a text answer as text.
    const sim = await simulateQuestionnaireDraft({ draftId: opened.draftId, turns: [['היי'], ['אחר'], ['פן לחתונה']] })
    if (sim.ok === false) throw new Error(JSON.stringify(sim))
    expect(sim.turns[2].explanation.recognized).toContainEqual(
      expect.objectContaining({ questionId: followUpId, text: 'פן לחתונה' }),
    )
    expect(sim.turns[2].explanation.recognized.find((r) => r.questionId === followUpId)?.optionIds).toBeUndefined()
    expect(t.agencyId).toBeGreaterThan(0)
  })

  it('a dashed agency name never reaches the first-run opening', async () => {
    await makeAgency('Demo — Yuton', null)
    const opened = await openQuestionnaireDraft()
    if (opened.ok === false) throw new Error(JSON.stringify(opened))
    expect(opened.questionnaire.opening).toContain('ל־Demo Yuton.')
    expect(hasCustomerFacingDash(opened.questionnaire.opening)).toBe(false)
    expect(opened.issues.every((i) => i.code === 'missing_text')).toBe(true)
  })
})

describe('history', () => {
  it('names the publisher when known; restore copies into a draft and publishes as the NEXT revision', async () => {
    const t = await makeAgency('pr2-pp', PP)
    const d = await openQuestionnaireDraft()
    if (d.ok === false) throw new Error(JSON.stringify(d))
    const changed = { ...d.questionnaire, opening: 'פתיחה חדשה' }
    const s = await saveQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1, questionnaire: changed })
    if (s.ok === false) throw new Error(JSON.stringify(s))
    expect(await publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 2 })).toMatchObject({ ok: true, revision: 5 })

    const list = await listQuestionnaireRevisions()
    expect(list).toMatchObject({
      ok: true,
      revisions: [
        { revision: 5, publishedBy: t.adminId, publishedByName: 'דנה כהן', source: 'builder' },
        { revision: 4, publishedBy: null, publishedByName: null, source: 'backfill' },
      ],
    })

    // Restore 4: the editor discards its draft (if any), then opens from 4.
    const fresh = await openQuestionnaireDraft()
    if (fresh.ok === false) throw new Error(JSON.stringify(fresh))
    expect(await discardQuestionnaireDraft({ draftId: fresh.draftId, expectedVersion: fresh.draftVersion })).toEqual({ ok: true })
    const restored = await openQuestionnaireDraft({ fromRevision: 4 })
    if (restored.ok === false) throw new Error(JSON.stringify(restored))
    expect(restored.questionnaire.opening).toBe(PP.welcome)
    expect(restored.baseRevision).toBe(5)
    expect(await publishQuestionnaireDraft({ draftId: restored.draftId, expectedVersion: 1 })).toMatchObject({
      ok: true,
      revision: 6,
    })
    const rows = await db('questionnaire_revisions').where({ agencyId: t.agencyId }).orderBy('revision')
    expect(rows.map((r) => [r.status, r.revision])).toEqual([
      ['published', 4],
      ['published', 5],
      ['published', 6],
    ])
    expect(rows[0].definition).toEqual(PP)
    expect(rows[2].definition).toEqual({ ...PP, revision: 6 })
  })

  it('never names a user of another agency', async () => {
    const a = await makeAgency('pr2-a', PP)
    const other = await makeAgency('pr2-b', null)
    // A row whose publisher id points at another agency's user (cannot happen through the app).
    const [row] = await db('questionnaire_revisions').where({ agencyId: a.agencyId, status: 'published' })
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL questionnaire.allow_purge = 'on'`)
      await trx('questionnaire_revisions').where({ id: row.id }).del()
    })
    await db('questionnaire_revisions').insert({ ...row, id: undefined, publishedBy: other.adminId })
    auth.user = { id: a.adminId, agencyId: a.agencyId, role: 'ADMIN' }
    const list = await listQuestionnaireRevisions()
    expect(list).toMatchObject({ ok: true, revisions: [{ revision: 4, publishedByName: null }] })
  })
})
