/**
 * Lead notes against a real database: isolation between agencies and reps, the
 * write and its lastActivityAt stamp, and that a note goes with its lead.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn(), unstable_cache: vi.fn((fn: unknown) => fn) }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/lib/requireUser', () => ({ requireBasicCrmAccess: vi.fn() }))
vi.mock('@/db/filter', () => ({ getPerms: vi.fn() }))

import { requireBasicCrmAccess } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { db } from '@/config/db'
import { addLeadNote, deleteLeadNote, editLeadNote } from '@/actions/leadNotes'
import { getLeadNotes } from '@/db/leadNotes'
import { LEAD_NOTE_MAX_LENGTH } from '@/lib/leads/leadNotes'

const NAMES = ['__notes_agency_A__', '__notes_agency_B__']
let agencyA: number
let agencyB: number
let adminA: any
let repA: any
let adminB: any
let leadId: number

function actAs(user: any, gotPermIds: number[] = [user.id]) {
  vi.mocked(requireBasicCrmAccess).mockResolvedValue(user)
  vi.mocked(getPerms).mockResolvedValue({ gotPermIds } as never)
}

async function purge() {
  const ids = (await db('agencies').whereIn('name', NAMES).select('id')).map((a: { id: number }) => a.id)
  if (!ids.length) return
  await db('clients').whereIn('agencyId', ids).delete()
  await db('users').whereIn('agencyId', ids).delete()
  await db('agencies').whereIn('id', ids).delete()
}

const seedUser = async (agencyId: number, role: string, lastName: string) => {
  const [u] = await db('users').insert({ firstName: '__notes__', lastName, role: role as never, agencyId }).returning('*')
  return { ...u, name: `נציג ${lastName}` }
}

describe.skipIf(process.env.VITEST_NO_DB === '1')('lead notes', () => {
  beforeAll(async () => {
    await purge()
    ;[{ id: agencyA }] = await db('agencies').insert({ name: NAMES[0] }).returning('id')
    ;[{ id: agencyB }] = await db('agencies').insert({ name: NAMES[1] }).returning('id')
    adminA = await seedUser(agencyA, 'ADMIN', 'AdminA')
    repA = await seedUser(agencyA, 'AGNT', 'RepA')
    adminB = await seedUser(agencyB, 'ADMIN', 'AdminB')
  })

  beforeEach(async () => {
    await db('clients').where({ agencyId: agencyA }).delete()
    ;[{ id: leadId }] = await db('clients')
      .insert({ firstName: 'דנה', lastName: 'לוי', agencyId: agencyA, createdById: adminA.id, userId: adminA.id, lead: true })
      .returning('id')
  })

  afterAll(async () => {
    await purge()
    await db.destroy()
  })

  it('saves the note with its author, stamps activity, and lists newest first', async () => {
    actAs(adminA)
    const first = await addLeadNote({ leadId, content: '  דיברנו, מעוניינת בחבילה הגדולה  ' })
    const second = await addLeadNote({ leadId, content: 'סיכמנו לחזור ביום ראשון' })
    expect(first).toMatchObject({ note: { content: 'דיברנו, מעוניינת בחבילה הגדולה', userName: adminA.name } })

    const notes = await getLeadNotes(adminA, leadId)
    expect(notes.map((n) => n.content)).toEqual(['סיכמנו לחזור ביום ראשון', 'דיברנו, מעוניינת בחבילה הגדולה'])
    expect('note' in second && notes[0].id).toBe('note' in second && second.note.id)

    const lead = await db('clients').where({ id: leadId }).first('lastActivityAt')
    expect(lead.lastActivityAt).not.toBeNull()
  })

  it('rejects empty and oversized notes without writing', async () => {
    actAs(adminA)
    expect(await addLeadNote({ leadId, content: '   ' })).toEqual({ err: 'empty' })
    expect(await addLeadNote({ leadId, content: 'א'.repeat(LEAD_NOTE_MAX_LENGTH + 1) })).toEqual({ err: 'tooLong' })
    expect(await db('lead_notes').where({ leadId })).toHaveLength(0)
  })

  it('never crosses agencies: no read, no write, no delete', async () => {
    actAs(adminA)
    const added = await addLeadNote({ leadId, content: 'פרטי' })
    const noteId = 'note' in added ? added.note.id : -1

    actAs(adminB)
    expect(await getLeadNotes(adminB, leadId)).toEqual([])
    expect(await addLeadNote({ leadId, content: 'חדירה' })).toEqual({ err: 'notFound' })
    expect(await deleteLeadNote({ id: noteId })).toEqual({ err: 'notFound' })
    expect(await db('lead_notes').where({ leadId })).toHaveLength(1)
  })

  it('stops a rep without permission for the lead, inside the same agency', async () => {
    actAs(adminA)
    const added = await addLeadNote({ leadId, content: 'של המנהל' })
    const noteId = 'note' in added ? added.note.id : -1

    actAs(repA)
    expect(await getLeadNotes(repA, leadId)).toEqual([])
    expect(await addLeadNote({ leadId, content: 'לא מורשה' })).toEqual({ err: 'notFound' })
    expect(await deleteLeadNote({ id: noteId })).toEqual({ err: 'notFound' })

    actAs(repA, [repA.id, adminA.id])
    expect(await getLeadNotes(repA, leadId)).toHaveLength(1)
    expect(await addLeadNote({ leadId, content: 'מורשה' })).toMatchObject({ note: { userName: repA.name } })
  })

  it('edits a note under the editor name, and only with access to the lead', async () => {
    actAs(adminA)
    const added = await addLeadNote({ leadId, content: 'טעות כתיב' })
    const id = 'note' in added ? added.note.id : -1

    actAs(adminB)
    expect(await editLeadNote({ id, content: 'חדירה' })).toEqual({ err: 'notFound' })
    actAs(repA)
    expect(await editLeadNote({ id, content: 'לא מורשה' })).toEqual({ err: 'notFound' })
    actAs(adminA)
    expect(await editLeadNote({ id, content: '   ' })).toEqual({ err: 'empty' })
    expect((await getLeadNotes(adminA, leadId))[0].content).toBe('טעות כתיב')

    actAs(repA, [repA.id, adminA.id])
    expect(await editLeadNote({ id, content: 'נוסח מתוקן' })).toMatchObject({ note: { id, content: 'נוסח מתוקן', userName: repA.name } })
    expect(await db('lead_notes').where({ leadId })).toHaveLength(1)
  })

  it('deletes a note, and a deleted lead takes its notes with it', async () => {
    actAs(adminA)
    const added = await addLeadNote({ leadId, content: 'למחיקה' })
    await addLeadNote({ leadId, content: 'נשאר' })
    expect(await deleteLeadNote({ id: 'note' in added ? added.note.id : -1 })).toEqual({ ok: true })
    expect((await getLeadNotes(adminA, leadId)).map((n) => n.content)).toEqual(['נשאר'])

    await db('clients').where({ id: leadId }).delete()
    expect(await db('lead_notes').where({ leadId })).toHaveLength(0)
  })
})
