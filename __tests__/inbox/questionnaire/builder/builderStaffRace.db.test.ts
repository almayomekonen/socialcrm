import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'

/**
 * Review finding (PR1): the staff path checks for an owner draft, then inserts
 * its own. If an owner opens a draft in between, the insert returns the OWNER's
 * draft (that is how concurrent opens converge). The staff path must refuse,
 * never publish the owner's content under the staff definition.
 *
 * The interleaving is forced deterministically: the staff path's draft check is
 * made to miss a draft that already exists.
 */
const race = vi.hoisted(() => ({ hideDraftOnce: false }))
vi.mock('@/db/questionnaireRevisions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/questionnaireRevisions')>()
  return {
    ...original,
    getDraft: async (...args: Parameters<typeof original.getDraft>) => {
      if (race.hideDraftOnce) {
        race.hideDraftOnce = false
        return null
      }
      return original.getDraft(...args)
    },
  }
})

import { publishDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/publish'
import { insertDraft } from '@/db/questionnaireRevisions'

const PP = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8'))
const agencies: number[] = []

afterAll(async () => {
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL questionnaire.allow_purge = 'on'`)
    await trx('questionnaire_revisions').whereIn('agencyId', agencies).del()
  })
  await db('agencies').whereIn('id', agencies).del()
})

describe('staff publish racing an owner who just opened a draft', () => {
  it('refuses, and the owner draft is neither published nor changed', async () => {
    const [a] = await db('agencies').insert({ name: 'qb-staff-race', autoResponseEnabled: true, plan: 'pro' }).returning('id')
    const agencyId = Number(a.id)
    agencies.push(agencyId)
    const ownerContent = { ...PP, welcome: 'טיוטה של הבעלים' }
    const { row: ownerDraft } = await insertDraft({ agencyId, definition: ownerContent, baseRevision: null, userId: 1, source: 'builder' })

    race.hideDraftOnce = true
    expect(await publishDefinition({ agencyId, definition: PP })).toEqual({ ok: false, reason: 'owner_draft_exists' })

    const rows = await db('questionnaire_revisions').where({ agencyId })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'draft', revision: null })
    expect(Number(rows[0].id)).toBe(ownerDraft.id)
    expect(rows[0].definition.welcome).toBe('טיוטה של הבעלים')
  })
})
