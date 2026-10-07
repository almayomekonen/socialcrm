import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { db } from '@/config/db'

/**
 * Questionnaire Builder PR1 against a real database: storage, immutability,
 * the draft lifecycle, publish routing semantics, concurrency, idempotency,
 * tenancy, the staff path, the migration backfill, and what a first publish
 * does to the real settings pages.
 *
 * Authentication is the only thing faked: `requireProductAccess` returns the
 * user a test chooses, exactly as the session would.
 */

const auth = vi.hoisted(() => ({ user: null as null | { id: number; agencyId: number; role: string }, mobile: false }))
vi.mock('@/lib/requireUser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/requireUser')>()),
  requireProductAccess: async () => auth.user,
  requireAgencyUser: async () => auth.user,
}))
vi.mock('@/lib/device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/device')>()),
  isMobileWorkspaceRequest: async () => auth.mobile,
}))
vi.mock('@/lib/access/productAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access/productAccess')>()),
  getAgencyProductAccess: async () => ({ status: 'PAID', hasAccess: true }),
}))

import {
  checkQuestionnaireDraft,
  discardQuestionnaireDraft,
  getQuestionnaireBuilderState,
  openQuestionnaireDraft,
  saveQuestionnaireDraft,
} from '@/actions/questionnaire/builderDraft'
import {
  getQuestionnaireRevision,
  listQuestionnaireRevisions,
  publishQuestionnaireDraft,
  simulateQuestionnaireDraft,
} from '@/actions/questionnaire/builderPublish'
import { publishDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/publish'
import { getChannelSettings } from '@/db/autoResponseSettings'
import AutoResponseSettingsPage from '@/app/(app)/settings/(admin_settings)/auto-response/page'
import AutoResponseMobile from '@/modules/settings/mobile/AutoResponseMobile'

const PP = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/perfect-picture.he.json'), 'utf8'))
const migration = require(path.join(process.cwd(), 'migrations/20261006120000_questionnaire_revisions.cjs'))

const agencies: number[] = []
type Tenant = { agencyId: number; adminId: number; agentId: number }

async function makeAgency(
  name: string,
  settings: 'none' | { responder: 'agent' | 'questionnaire'; questionnaire: unknown | null; enabled?: boolean },
): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `qb-${name}`, autoResponseEnabled: true, plan: 'pro' }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [admin] = await db('users').insert({ firstName: 'א', role: 'ADMIN', agencyId }).returning('id')
  const [agent] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  if (settings !== 'none') {
    await db('auto_response_settings').insert({
      agencyId,
      channel: 'whatsapp',
      enabled: settings.enabled ?? true,
      mode: 'acknowledge',
      replyMode: 'ai',
      responder: settings.responder,
      questionnaire: settings.questionnaire == null ? null : JSON.stringify(settings.questionnaire),
    })
  }
  return { agencyId, adminId: Number(admin.id), agentId: Number(agent.id) }
}

/** What the migration's backfill does for a live questionnaire, for agencies created after it ran. */
async function backfill(): Promise<void> {
  await migration.up(db)
}

const as = (t: Tenant, role: 'ADMIN' | 'AGNT' = 'ADMIN') => {
  auth.user = { id: role === 'ADMIN' ? t.adminId : t.agentId, agencyId: t.agencyId, role }
}

const settingsRow = (t: Tenant) => db('auto_response_settings').where({ agencyId: t.agencyId, channel: 'whatsapp' }).first()
const rowsOf = (t: Tenant) => db('questionnaire_revisions').where({ agencyId: t.agencyId }).orderBy('id')
const fingerprint = async (t: Tenant) =>
  JSON.stringify({
    settings: await settingsRow(t),
    published: await db('questionnaire_revisions').where({ agencyId: t.agencyId, status: 'published' }).orderBy('id'),
    sessions: await db('questionnaire_sessions').where({ agencyId: t.agencyId }).orderBy('id'),
  })

function editedWeddingUrl(questionnaire: { endings: { custom: Array<{ message: string }> } }) {
  const copy = JSON.parse(JSON.stringify(questionnaire))
  copy.endings.custom[2].message = copy.endings.custom[2].message.replace('https://wisepage.wwcrm.co.il/picture-perfect', 'https://example.org/weddings')
  return copy
}

const SALON = {
  opening: 'שלום, נשמח להכיר אותך',
  questions: [
    {
      label: 'טיפול',
      prompt: 'איזה טיפול מעניין אותך?',
      shownWhen: { mode: 'always' },
      answer: { kind: 'single_choice', options: [{ label: 'איפור' }, { label: 'שיער' }, { label: 'איפור ושיער' }] },
    },
    { label: 'תאריך', prompt: 'לאיזה תאריך?', shownWhen: { mode: 'always' }, answer: { kind: 'date', notSetAllowed: true } },
  ],
  endings: { standard: 'תודה! נחזור אלייך בהקדם 🙏', custom: [] },
  handoffMessage: 'תודה! העברנו את השיחה לצוות.',
  summaryTitle: 'שאלון וואטסאפ הושלם',
  settings: { attemptsBeforePerson: 2, abandonAfterHours: 24 },
}

beforeAll(() => {
  process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = 'all'
})
beforeEach(() => {
  auth.mobile = false
})
afterAll(async () => {
  delete process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL questionnaire.allow_purge = 'on'`)
    await trx('questionnaire_revisions').whereIn('agencyId', agencies).del()
  })
  await db('questionnaire_sessions').whereIn('agencyId', agencies).del()
  await db('analytics_events').whereIn('agencyId', agencies).del()
  await db('auto_response_settings').whereIn('agencyId', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('migration: backfill and immutability', () => {
  it('backfills a live questionnaire as one published revision, idempotently, and touches no session', async () => {
    const t = await makeAgency('backfill', { responder: 'questionnaire', questionnaire: PP })
    const none = await makeAgency('backfill-none', { responder: 'agent', questionnaire: null })
    const [conv] = await db('inbox_conversations').insert({ agencyId: t.agencyId, channel: 'whatsapp', businessPhoneNumberId: 'pn-bf', customerWaId: '972500000001' }).returning('id')
    await db('questionnaire_sessions').insert({ agencyId: t.agencyId, conversationId: conv.id, definition: JSON.stringify({ ...PP, revision: 2 }), definitionRevision: 2 })
    const sessionsBefore = JSON.stringify(await db('questionnaire_sessions').where({ agencyId: t.agencyId }))

    await backfill()
    await backfill()
    const rows = await rowsOf(t)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'published', revision: 4, source: 'backfill', publishedBy: null })
    expect(rows[0].definition).toEqual(PP)
    expect(await rowsOf(none)).toHaveLength(0)
    expect(JSON.stringify(await db('questionnaire_sessions').where({ agencyId: t.agencyId }))).toBe(sessionsBefore)
    await db('questionnaire_sessions').where({ agencyId: t.agencyId }).del()
    await db('inbox_conversations').where({ id: conv.id }).del()
  })

  it('a published revision cannot be updated or deleted; only an explicit purge may delete', async () => {
    const t = await makeAgency('immutable', { responder: 'questionnaire', questionnaire: PP })
    await backfill()
    const [row] = await rowsOf(t)
    await expect(db('questionnaire_revisions').where({ id: row.id }).update({ definition: JSON.stringify({ hacked: true }) })).rejects.toThrow(/immutable/)
    await expect(db('questionnaire_revisions').where({ id: row.id }).update({ status: 'draft', revision: null, publishedAt: null })).rejects.toThrow(/immutable/)
    await expect(db('questionnaire_revisions').where({ id: row.id }).del()).rejects.toThrow(/immutable/)
    await expect(
      db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL questionnaire.allow_purge = 'on'`)
        await trx('questionnaire_revisions').where({ id: row.id }).update({ definition: JSON.stringify({ hacked: true }) })
      }),
    ).rejects.toThrow(/immutable/)
    expect((await rowsOf(t))[0].definition).toEqual(PP)
  })

  it('down() removes everything it created; up() recreates it (in a rolled-back transaction)', async () => {
    const rollback = new Error('rollback')
    await expect(
      db.transaction(async (trx) => {
        await migration.down(trx)
        const gone = await trx.raw(`SELECT to_regclass('public.questionnaire_revisions') AS t, to_regproc('public.questionnaire_revisions_immutable') AS f`)
        expect(gone.rows[0]).toEqual({ t: null, f: null })
        await migration.up(trx)
        const back = await trx.raw(`SELECT to_regclass('public.questionnaire_revisions')::text AS t,
          (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'questionnaire_revisions_immutable_trg') AS triggers`)
        expect(back.rows[0]).toEqual({ t: 'questionnaire_revisions', triggers: 1 })
        throw rollback
      }),
    ).rejects.toBe(rollback)
  })

  it('the runtime never reads the table', async () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/inbox/autoresponse/questionnaire/processJob.ts'), 'utf8')
    expect(src).not.toContain('questionnaire_revisions')
    expect(fs.readFileSync(path.join(process.cwd(), 'db/autoResponseSettings.ts'), 'utf8')).not.toContain('questionnaire_revisions')
  })
})

describe('Perfect Picture: revision 4 → draft → edit → simulate → publish 5', () => {
  it('drafts in isolation, publishes N+1, keeps routing, never touches revision 4 or sessions', async () => {
    const t = await makeAgency('pp', { responder: 'questionnaire', questionnaire: PP })
    await backfill()
    as(t)
    const before = await fingerprint(t)

    const state = await getQuestionnaireBuilderState()
    expect(state).toMatchObject({ ok: true, published: { revision: 4 }, draft: null, live: { routedToQuestionnaire: true } })

    const opened = await openQuestionnaireDraft()
    if (!opened.ok) throw new Error(JSON.stringify(opened))
    expect(opened).toMatchObject({ draftVersion: 1, baseRevision: 4, ready: true })

    const saved = await saveQuestionnaireDraft({ draftId: opened.draftId, expectedVersion: 1, questionnaire: editedWeddingUrl(opened.questionnaire) })
    if (!saved.ok) throw new Error(JSON.stringify(saved))
    expect(saved.draftVersion).toBe(2)
    expect(saved.questionnaire.questions.map((q) => q.id)).toEqual(opened.questionnaire.questions.map((q) => q.id))
    expect(await fingerprint(t)).toBe(before) // draft isolation

    const sim = await simulateQuestionnaireDraft({ draftId: opened.draftId, turns: [['היי'], ['אנחנו מתחתנים'], ['18.11.2026'], ['רחובות'], ['סטילס']] })
    if (!sim.ok) throw new Error(JSON.stringify(sim))
    expect(sim.turns[1].explanation.recognized[0]).toMatchObject({ questionId: 'event_type', optionIds: ['wedding'], fromWords: 'אנחנו מתחתנים' })
    expect(sim.turns[4].replies[0]).toContain('https://example.org/weddings')
    expect(sim.status).toBe('completed')
    expect(await fingerprint(t)).toBe(before) // simulation writes nothing

    expect(await checkQuestionnaireDraft({ draftId: opened.draftId })).toMatchObject({ ok: true, ready: true })
    const published = await publishQuestionnaireDraft({ draftId: opened.draftId, expectedVersion: 2 })
    expect(published).toMatchObject({ ok: true, revision: 5 })

    const live = await settingsRow(t)
    expect(live.questionnaire.revision).toBe(5)
    expect(live.questionnaire.closingVariants[2].text).toContain('https://example.org/weddings')
    expect(live.responder).toBe('questionnaire') // routing unchanged
    const rows = await rowsOf(t)
    expect(rows.map((r) => [r.status, r.revision])).toEqual([['published', 4], ['published', 5]])
    expect(rows[0].definition).toEqual(PP) // revision 4 intact
    expect(await listQuestionnaireRevisions()).toMatchObject({ ok: true, revisions: [{ revision: 5, source: 'builder' }, { revision: 4, source: 'backfill' }] })
    expect(await getQuestionnaireRevision({ revision: 4 })).toMatchObject({ ok: true, revision: 4 })
  })
})

describe('publish never changes routing', () => {
  it('an agency on the AI agent stays on the AI agent', async () => {
    const t = await makeAgency('ai', { responder: 'agent', questionnaire: { ...PP, revision: 2 } })
    await backfill()
    as(t)
    const d = await openQuestionnaireDraft()
    if (!d.ok) throw new Error(JSON.stringify(d))
    const r = await publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1 })
    expect(r).toMatchObject({ ok: true, revision: 3 })
    const live = await settingsRow(t)
    expect(live).toMatchObject({ responder: 'agent', enabled: true, replyMode: 'ai' })
    expect(live.questionnaire.revision).toBe(3)
  })

  it('a new agency: revision 1 exists, no settings row, nothing routed, settings pages unchanged', async () => {
    const t = await makeAgency('salon', 'none')
    as(t)
    const page = async () => renderToStaticMarkup(await AutoResponseSettingsPage())
    const mobile = async () => renderToStaticMarkup(await AutoResponseMobile({ agencyId: t.agencyId, role: 'ADMIN' as never }))
    const [desktopBefore, mobileBefore] = [await page(), await mobile()]

    expect(await getQuestionnaireBuilderState()).toMatchObject({ ok: true, published: null, draft: null, live: { hasSettings: false, routedToQuestionnaire: false } })
    const d = await openQuestionnaireDraft()
    if (!d.ok) throw new Error(JSON.stringify(d))
    expect(d.ready).toBe(false) // an honest, incomplete start: a first question whose answers the owner writes
    expect(d.issues.map((i) => i.code)).toEqual(['missing_text', 'missing_text'])

    const saved = await saveQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1, questionnaire: SALON })
    if (!saved.ok) throw new Error(JSON.stringify(saved))
    expect(saved.ready).toBe(true)
    expect(saved.questionnaire.questions.every((q) => /^q_[a-z0-9]{8}$/.test(q.id as string))).toBe(true)
    expect(saved.view.questions.map((q) => q.answerSummary)).toEqual(['בחירה אחת · 3 אפשרויות', 'תאריך · אפשר להמשיך גם בלי תאריך'])

    expect(await simulateQuestionnaireDraft({ turns: [Array.from({ length: 11 }, () => 'היי')] })).toEqual({ ok: false, reason: 'bad_input' })
    const sim = await simulateQuestionnaireDraft({ turns: [['היי'], ['שיער'], ['עדיין לא נקבע']] })
    if (!sim.ok) throw new Error(JSON.stringify(sim))
    expect(sim.status).toBe('completed')
    expect(sim.summary.fields).toContainEqual({ label: 'תאריך', value: 'טרם נקבע' })

    expect(await publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 2 })).toMatchObject({ ok: true, revision: 1 })
    expect(await settingsRow(t)).toBeUndefined()
    expect(await getChannelSettings(t.agencyId, 'whatsapp')).toBeNull()
    expect(await page()).toBe(desktopBefore)
    auth.mobile = true
    expect(await mobile()).toBe(mobileBefore)
  })

  it('an agency already on the questionnaire keeps it (see the Perfect Picture walkthrough)', async () => {
    const t = await makeAgency('routed', { responder: 'questionnaire', questionnaire: PP, enabled: false })
    await backfill()
    as(t)
    const d = await openQuestionnaireDraft()
    if (!d.ok) throw new Error(JSON.stringify(d))
    await publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1 })
    expect(await settingsRow(t)).toMatchObject({ responder: 'questionnaire', enabled: false })
  })
})

describe('concurrency and idempotency', () => {
  it('tab B saving over tab A gets a conflict with the current version, never a silent overwrite', async () => {
    const t = await makeAgency('tabs', { responder: 'questionnaire', questionnaire: PP })
    await backfill()
    as(t)
    const d = await openQuestionnaireDraft()
    if (!d.ok) throw new Error(JSON.stringify(d))
    let version = 1
    for (; version < 5; version++) {
      const r = await saveQuestionnaireDraft({ draftId: d.draftId, expectedVersion: version, questionnaire: d.questionnaire })
      if (!r.ok) throw new Error(JSON.stringify(r))
    }
    const tabA = await saveQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 5, questionnaire: editedWeddingUrl(d.questionnaire) })
    expect(tabA).toMatchObject({ ok: true, draftVersion: 6 })
    const tabB = await saveQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 5, questionnaire: d.questionnaire })
    expect(tabB).toEqual({ ok: false, reason: 'version_conflict', currentVersion: 6 })
    expect(await discardQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 5 })).toMatchObject({ reason: 'version_conflict', currentVersion: 6 })
  })

  it('two tabs opening at once get the same single draft', async () => {
    const t = await makeAgency('open-race', { responder: 'questionnaire', questionnaire: PP })
    await backfill()
    as(t)
    const [a, b] = await Promise.all([openQuestionnaireDraft(), openQuestionnaireDraft()])
    if (!a.ok || !b.ok) throw new Error('open')
    expect(a.draftId).toBe(b.draftId)
    expect((await rowsOf(t)).filter((r) => r.status === 'draft')).toHaveLength(1)
  })

  it('a double click publishes exactly once; the repeat returns the same revision', async () => {
    const t = await makeAgency('double', { responder: 'questionnaire', questionnaire: PP })
    await backfill()
    as(t)
    const d = await openQuestionnaireDraft()
    if (!d.ok) throw new Error(JSON.stringify(d))
    const [first, second] = await Promise.all([
      publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1 }),
      publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1 }),
    ])
    const results = [first, second].sort((x, y) => Number('alreadyPublished' in x) - Number('alreadyPublished' in y))
    expect(results[0]).toMatchObject({ ok: true, revision: 5 })
    expect(results[1]).toMatchObject({ ok: true, revision: 5, alreadyPublished: true })
    expect(await publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1 })).toMatchObject({ ok: true, revision: 5, alreadyPublished: true })
    expect((await rowsOf(t)).map((r) => r.revision)).toEqual([4, 5])
  })

  it('a draft based on an old revision cannot be published over a newer one', async () => {
    const t = await makeAgency('stale', { responder: 'questionnaire', questionnaire: PP })
    await backfill()
    as(t)
    const d = await openQuestionnaireDraft()
    if (!d.ok) throw new Error(JSON.stringify(d))
    // A revision published by another path while this draft was open.
    await db('questionnaire_revisions').insert({ agencyId: t.agencyId, channel: 'whatsapp', status: 'published', revision: 5, definition: JSON.stringify({ ...PP, revision: 5 }), source: 'staff', publishedAt: db.fn.now() })
    expect(await publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1 })).toEqual({ ok: false, reason: 'draft_out_of_date', latestRevision: 5 })
    expect((await rowsOf(t)).find((r) => Number(r.id) === d.draftId)?.status).toBe('draft')
  })

  it('a refused publish changes nothing', async () => {
    const t = await makeAgency('refused', { responder: 'questionnaire', questionnaire: PP })
    await backfill()
    as(t)
    const d = await openQuestionnaireDraft()
    if (!d.ok) throw new Error(JSON.stringify(d))
    const broken = JSON.parse(JSON.stringify(d.questionnaire))
    broken.questions[1].prompt = ''
    const saved = await saveQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 1, questionnaire: broken })
    expect(saved).toMatchObject({ ok: true, ready: false })
    const before = await fingerprint(t)
    const r = await publishQuestionnaireDraft({ draftId: d.draftId, expectedVersion: 2 })
    expect(r).toMatchObject({ ok: false, reason: 'invalid', issues: [expect.objectContaining({ code: 'missing_text', questionId: 'event_other' })] })
    expect(await fingerprint(t)).toBe(before)
  })
})

describe('authorization and tenancy', () => {
  it('another agency\'s drafts and revisions are invisible and untouchable', async () => {
    const victim = await makeAgency('victim', { responder: 'questionnaire', questionnaire: PP })
    const attacker = await makeAgency('attacker', { responder: 'agent', questionnaire: { ...PP, revision: 1 } })
    await backfill()
    as(victim)
    const vd = await openQuestionnaireDraft()
    if (!vd.ok) throw new Error(JSON.stringify(vd))
    const before = JSON.stringify(await rowsOf(victim))

    as(attacker)
    expect(await getQuestionnaireRevision({ revision: 4 })).toMatchObject({ ok: false, reason: 'revision_not_found' })
    expect(await openQuestionnaireDraft({ fromRevision: 4 })).toMatchObject({ ok: false, reason: 'revision_not_found' })
    expect(await saveQuestionnaireDraft({ draftId: vd.draftId, expectedVersion: 1, questionnaire: vd.questionnaire })).toMatchObject({ ok: false, reason: 'not_found' })
    expect(await discardQuestionnaireDraft({ draftId: vd.draftId, expectedVersion: 1 })).toMatchObject({ ok: false, reason: 'not_found' })
    expect(await checkQuestionnaireDraft({ draftId: vd.draftId })).toMatchObject({ ok: false, reason: 'not_found' })
    expect(await simulateQuestionnaireDraft({ draftId: vd.draftId, turns: [['היי']] })).toMatchObject({ ok: false, reason: 'not_found' })
    expect(await publishQuestionnaireDraft({ draftId: vd.draftId, expectedVersion: 1 })).toMatchObject({ ok: false, reason: 'not_found' })
    const own = await getQuestionnaireBuilderState()
    expect(own).toMatchObject({ ok: true, published: { revision: 1 }, draft: null })
    expect(JSON.stringify(await rowsOf(victim))).toBe(before)
  })

  it('non-admins and agencies outside the rollout are refused', async () => {
    const t = await makeAgency('roles', { responder: 'questionnaire', questionnaire: PP })
    await backfill()
    as(t, 'AGNT')
    expect(await getQuestionnaireBuilderState()).toEqual({ ok: false, reason: 'forbidden' })
    expect(await openQuestionnaireDraft()).toEqual({ ok: false, reason: 'forbidden' })
    as(t)
    process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = String(t.agencyId + 1)
    expect(await getQuestionnaireBuilderState()).toEqual({ ok: false, reason: 'forbidden' })
    expect(await publishQuestionnaireDraft({ draftId: 1, expectedVersion: 1 })).toEqual({ ok: false, reason: 'forbidden' })
    process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = ''
    expect(await listQuestionnaireRevisions()).toEqual({ ok: false, reason: 'forbidden' })
    process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS = 'all'
  })
})

describe('staff path: configure.ts publishes through the same service', () => {
  it('records a staff revision, refuses over an owner draft unless told, never changes routing', async () => {
    const t = await makeAgency('staff', { responder: 'agent', questionnaire: PP })
    await backfill()
    as(t)
    const d = await openQuestionnaireDraft()
    if (!d.ok) throw new Error(JSON.stringify(d))
    expect(await publishDefinition({ agencyId: t.agencyId, definition: PP })).toEqual({ ok: false, reason: 'owner_draft_exists' })
    expect(await publishDefinition({ agencyId: t.agencyId, definition: PP, discardDraft: true })).toMatchObject({ ok: true, revision: 5 })
    const rows = await rowsOf(t)
    expect(rows.map((r) => [r.status, r.revision, r.source])).toEqual([['published', 4, 'backfill'], ['published', 5, 'staff']])
    expect(await settingsRow(t)).toMatchObject({ responder: 'agent' })
  })

  it('no other code writes the live questionnaire', () => {
    const roots = ['lib', 'db', 'actions', 'app', 'modules', 'components', 'scripts/questionnaire']
    const writers: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(entry.name) && /questionnaire:\s*JSON\.stringify/.test(fs.readFileSync(p, 'utf8'))) writers.push(p)
      }
    }
    for (const r of roots) walk(path.join(process.cwd(), r))
    expect(writers.map((w) => path.relative(process.cwd(), w))).toEqual(['lib/inbox/autoresponse/questionnaire/builder/publish.ts'])
  })
})
