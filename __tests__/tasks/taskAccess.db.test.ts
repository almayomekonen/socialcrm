import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The user-facing task boundaries (actions/tasks.ts asserts, db/tasks.ts
 * getTasks and the lead-page reads), against a real (local test) PostgreSQL.
 *
 * Before: the asserts checked the agency only (a rep could edit or delete a
 * colleague's task), and getTasks had no agency predicate (a lead elsewhere
 * created by the same user id was listed). Now both enforce agency AND role.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
// The lead-page reads take the actor from the session.
const session = vi.hoisted(() => ({ user: null as unknown }))
vi.mock('@/lib/requireUser', () => ({ requireUser: async () => session.user }))

import { db } from '@/config/db'
import { canActOnLead, canActOnTask } from '@/lib/tasks/taskAccess'
import { get5TasksByClientId, getTasks, getTasksByClientId, getTasksTbl } from '@/db/tasks'
import { Roles } from '@/types/roles'

let A: number
let B: number
let admin: { id: number; agencyId: number; role: string; name: string }
let rep: typeof admin
let colleague: typeof admin
const made = { agencies: [] as number[], users: [] as number[], clients: [] as number[] }

async function agency(name: string) {
  const [a] = await db('agencies').insert({ name }).returning('id')
  const id = Number(a.id ?? a)
  made.agencies.push(id)
  return id
}
async function user(agencyId: number, role: Roles) {
  const [u] = await db('users')
    .insert({
      firstName: role,
      lastName: `t${made.users.length}`,
      email: `ta-${role}-${Date.now()}-${Math.random()}@example.test`,
      agencyId,
      role,
    })
    .returning('id')
  const id = Number(u.id ?? u)
  made.users.push(id)
  return { id, agencyId, role, name: `${role} t` }
}
async function leadWithTask(agencyId: number, ownerId: number, createdById = ownerId) {
  const [c] = await db('clients')
    .insert({ firstName: 'ליד', lastName: 't', agencyId, userId: ownerId, createdById, lead: true })
    .returning('id')
  const clientId = Number(c.id ?? c)
  made.clients.push(clientId)
  const [t] = await db('tasks')
    .insert({ clientId, title: 'מעקב', userId: ownerId, dueDate: '2026-11-02', tasks: '[]', notes: '[]', files: [] } as never)
    .returning('id')
  return { clientId, taskId: Number(t.id ?? t) }
}

beforeAll(async () => {
  A = await agency('__task_access_a__')
  B = await agency('__task_access_b__')
  admin = await user(A, Roles.ADMIN)
  rep = await user(A, Roles.AGNT)
  colleague = await user(A, Roles.AGNT)
})
afterAll(async () => {
  await db('user_perms').whereIn('gotId', made.users).del()
  await db('tasks').whereIn('clientId', made.clients).del()
  await db('clients').whereIn('id', made.clients).del()
  await db('users').whereIn('id', made.users).del()
  await db('agencies').whereIn('id', made.agencies).del()
  await db.destroy()
})

describe('canActOnLead / canActOnTask (the asserts behind update, delete, create, add)', () => {
  it("a rep may act on their own lead's task, not on a colleague's in the same agency", async () => {
    const mine = await leadWithTask(A, rep.id)
    const theirs = await leadWithTask(A, colleague.id)
    expect(await canActOnLead(rep, mine.clientId)).toBe(true)
    expect(await canActOnTask(rep, mine.taskId)).toBe(true)
    expect(await canActOnLead(rep, theirs.clientId)).toBe(false)
    expect(await canActOnTask(rep, theirs.taskId)).toBe(false)
  })

  it('a lead the rep created (owned by someone else) stays actionable, matching what the task list shows', async () => {
    const created = await leadWithTask(A, colleague.id, rep.id)
    expect(await canActOnTask(rep, created.taskId)).toBe(true)
  })

  it('an admin may act on any lead of the agency', async () => {
    const theirs = await leadWithTask(A, colleague.id)
    expect(await canActOnTask(admin, theirs.taskId)).toBe(true)
  })

  it("nobody may act on another agency's lead or task, admin included", async () => {
    const other = await user(B, Roles.ADMIN)
    const foreign = await leadWithTask(B, other.id)
    for (const actor of [admin, rep]) {
      expect(await canActOnLead(actor, foreign.clientId)).toBe(false)
      expect(await canActOnTask(actor, foreign.taskId)).toBe(false)
    }
  })

  it('invalid ids and a missing agency are refused', async () => {
    for (const id of [0, -1, 'x', null, 1.5]) expect(await canActOnLead(admin, id)).toBe(false)
    expect(await canActOnTask({ ...admin, agencyId: null }, 1)).toBe(false)
  })
})

describe('getTasks (the task list)', () => {
  it("does not list another agency's tasks, even for a lead created by the same user id", async () => {
    const mine = await leadWithTask(A, rep.id)
    const elsewhere = await leadWithTask(B, rep.id) // e.g. created before the user moved agency
    const ids = (await getTasks(rep, {})).map((t: { id: number }) => Number(t.id))
    expect(ids).toContain(mine.taskId)
    expect(ids).not.toContain(elsewhere.taskId)
  })

  it('a user with no agency gets nothing', async () => {
    expect(await getTasks({ ...rep, agencyId: null }, {})).toEqual([])
  })
})

describe('lead-page task reads (getTasksByClientId, get5TasksByClientId, getTasksTbl)', () => {
  const readAll = async (actor: typeof admin, clientId: unknown) => {
    session.user = actor
    const sets = await Promise.all([getTasksByClientId(clientId), get5TasksByClientId(clientId), getTasksTbl(clientId)])
    return sets.map((rows) => rows.map((t: { id: number }) => Number(t.id)))
  }

  it("return nothing for another agency's lead id, admin included", async () => {
    const other = await user(B, Roles.ADMIN)
    const foreign = await leadWithTask(B, other.id)
    for (const actor of [admin, rep]) expect(await readAll(actor, foreign.clientId)).toEqual([[], [], []])
    expect(await readAll(other, foreign.clientId)).toEqual([[foreign.taskId], [foreign.taskId], [foreign.taskId]])
  })

  it("return nothing to a rep for a colleague's lead in the same agency", async () => {
    const theirs = await leadWithTask(A, colleague.id)
    expect(await readAll(rep, theirs.clientId)).toEqual([[], [], []])
  })

  it('return the tasks to the owning rep, to a rep who created the lead, and to an admin', async () => {
    const mine = await leadWithTask(A, rep.id)
    const created = await leadWithTask(A, colleague.id, rep.id)
    const theirs = await leadWithTask(A, colleague.id)
    expect(await readAll(rep, mine.clientId)).toEqual([[mine.taskId], [mine.taskId], [mine.taskId]])
    expect(await readAll(rep, created.clientId)).toEqual([[created.taskId], [created.taskId], [created.taskId]])
    expect(await readAll(admin, theirs.clientId)).toEqual([[theirs.taskId], [theirs.taskId], [theirs.taskId]])
  })

  it("follow user_perms: a rep granted a colleague's leads sees that colleague's tasks", async () => {
    const granted = await user(A, Roles.AGNT)
    const theirs = await leadWithTask(A, colleague.id)
    expect(await readAll(granted, theirs.clientId)).toEqual([[], [], []])
    await db('user_perms').insert({ gaveId: colleague.id, gotId: granted.id })
    expect(await readAll(granted, theirs.clientId)).toEqual([[theirs.taskId], [theirs.taskId], [theirs.taskId]])
  })

  it('keep the existing shape: titles only, newest five, and the assignee name', async () => {
    const mine = await leadWithTask(A, rep.id)
    session.user = rep
    expect(await getTasksByClientId(mine.clientId)).toEqual([{ id: mine.taskId, title: 'מעקב' }])
    expect(await getTasksTbl(mine.clientId)).toEqual([expect.objectContaining({ id: mine.taskId, userName: expect.any(String) })])
  })

  it('invalid lead ids return nothing', async () => {
    for (const id of [0, -1, 'x', null, 1.5]) expect(await readAll(admin, id)).toEqual([[], [], []])
  })
})
