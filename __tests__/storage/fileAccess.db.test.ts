import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { S3Client } from '@aws-sdk/client-s3'
import { db } from '@/config/db'
import { uploadKey } from '@/lib/storage/keys'

/**
 * Real database and real access rules; R2 is faked at S3Client.send, and presigning
 * (a local calculation) is real. Only `who is asking` is stubbed.
 */

const actor = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
vi.mock('@/lib/requireUser', async (original) => {
  const real = await original<typeof import('@/lib/requireUser')>()
  const require = async () => {
    if (!actor.current) throw new real.AuthError('no_session')
    return actor.current
  }
  return { ...real, requireUser: require, requireProductAccess: require }
})
vi.mock('@/db/auth', async (original) => ({ ...(await original<typeof import('@/db/auth')>()), getUser: async () => actor.current }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f }))
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (key: string) => key }))

import { GET } from '@/app/api/files/[fileId]/route'
import { addFiles, deleteFile, getPresigned } from '@/actions/files'
import { deleteTask, saveFilesTmplt } from '@/actions/tasks'
import { deleteLead, deleteManyLeads } from '@/actions/clients'
import { canReadFile, loadFileForAgency } from '@/lib/storage/fileAccess'

const A = 9101
const B = 9102
const ADMIN_A = 91010
const REP_A = 91011
const REP_A2 = 91012
const ADMIN_B = 91020
const GRANTED = 91013
const MANAGER = 91014
const OTHER_MANAGER = 91015
const HANDLER = 91016
const ASSIGNEE = 91017
const TEAM = 9101
let LEAD_A = 0
let LEAD_A2 = 0

const person = (id: number, agencyId: number, role: string) => ({ id, agencyId, role, name: 'x' })
const admin = person(ADMIN_A, A, 'ADMIN')
const rep = person(REP_A, A, 'AGNT')
const otherRep = person(REP_A2, A, 'AGNT')
const foreignAdmin = person(ADMIN_B, B, 'ADMIN')

const open = (id: number | string, qs = '') => GET(new NextRequest(`https://crm.test/api/files/${id}${qs}`), { params: Promise.resolve({ fileId: String(id) }) })

async function fileRow(over: Record<string, unknown> = {}) {
  const [row] = await db('files')
    .insert({ name: 'מסמך.pdf', type: 'application/pdf', size: '10', path: uploadKey(A, 'application/pdf'), agencyId: A, createdById: ADMIN_A, ...over } as never)
    .returning(['id', 'url', 'path'])
  return row as { id: number; url: string; path: string }
}

let logged: string[] = []
let send: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  for (const [agency, adminId] of [[A, ADMIN_A], [B, ADMIN_B]]) {
    await db('agencies').insert({ id: agency, name: `a${agency}`, plan: 'pro', country: 'IL', defaultCurrency: 'ILS', locale: 'he', docNumberFormat: '{n}', bankDetails: '{}' } as never)
    await db('users').insert({ id: adminId, agencyId: agency, email: `u${adminId}@t.test`, role: 'ADMIN', firstName: 'א', lastName: String(adminId) } as never)
  }
  await db('users').insert([
    { id: REP_A, agencyId: A, email: `u${REP_A}@t.test`, role: 'AGNT', firstName: 'א', lastName: String(REP_A) },
    { id: REP_A2, agencyId: A, email: `u${REP_A2}@t.test`, role: 'AGNT', firstName: 'א', lastName: String(REP_A2) },
  ] as never)
  await db('users').insert([GRANTED, MANAGER, OTHER_MANAGER, HANDLER, ASSIGNEE].map((id) => ({ id, agencyId: A, email: `u${id}@t.test`, role: id === MANAGER || id === OTHER_MANAGER ? 'MNGR' : 'AGNT', firstName: 'א', lastName: String(id) })) as never)
  await db('teams').insert({ id: TEAM, name: 'צוות', agencyId: A } as never)
  await db('user_teams').insert([
    { userId: MANAGER, teamId: TEAM, type: 'mngr' },
    { userId: REP_A, teamId: TEAM, type: 'user' },
  ] as never)
  const lead = async (userId: number) => (await db('clients').insert({ firstName: 'ל', lastName: 'ד', agencyId: A, createdById: userId, userId } as never).returning('id'))[0].id as number
  LEAD_A = await lead(REP_A)
  LEAD_A2 = await lead(REP_A2)
})

afterAll(async () => {
  await db.destroy()
})

beforeEach(() => {
  vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32))
  vi.stubEnv('R2_ACCESS_KEY_ID', 'FAKEKEYID')
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'fake-secret')
  vi.stubEnv('R2_BUCKET_NAME', 'test-bucket')
  actor.current = null
  logged = []
  const capture = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
  send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({ ContentLength: 10, ContentType: 'application/pdf' } as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('files.url', () => {
  it('is generated from the row id and names no storage provider', async () => {
    const row = await fileRow()
    expect(row.url).toBe(`/api/files/${row.id}`)
  })

  it('a stored URL cannot be written directly', async () => {
    await expect(db('files').insert({ name: 'x', agencyId: A, url: 'https://evil.example/x' } as never)).rejects.toThrow()
  })
})

describe('GET /api/files/[fileId]: who may read', () => {
  const lands = (res: Response) => new URL(res.headers.get('location')!)

  it('no session: 401, and R2 is not contacted', async () => {
    const f = await fileRow()
    expect((await open(f.id)).status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it('another agency, even its admin: indistinguishable from not existing, and logged', async () => {
    const f = await fileRow({ clientId: LEAD_A })
    actor.current = foreignAdmin
    const res = await open(f.id)
    expect(res.status).toBe(404)
    expect(res.headers.get('location')).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(logged.some((l) => l.includes('download.denied') && l.includes('not_in_agency'))).toBe(true)
  })

  it('a rep cannot read a colleague’s lead file', async () => {
    const f = await fileRow({ clientId: LEAD_A2, createdById: REP_A2 })
    actor.current = rep
    expect((await open(f.id)).status).toBe(404)
    expect(logged.some((l) => l.includes('download.denied') && l.includes('no_access'))).toBe(true)
  })

  it('a rep with access gets a 60-second redirect to R2, forced to the stored type', async () => {
    const f = await fileRow({ clientId: LEAD_A, createdById: REP_A2 })
    actor.current = rep
    const res = await open(f.id)
    expect(res.status).toBe(302)
    const url = lands(res)
    expect(url.host).toBe(`${'a'.repeat(32)}.r2.cloudflarestorage.com`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('the uploader and an admin can always read', async () => {
    const f = await fileRow({ clientId: LEAD_A2, createdById: REP_A })
    actor.current = rep
    expect((await open(f.id)).status).toBe(302)
    actor.current = admin
    expect((await open(f.id)).status).toBe(302)
  })

  it('a document with no lead (an Excel import) stays with its uploader', async () => {
    const f = await fileRow({ createdById: REP_A, type: 'application/vnd.ms-excel' })
    actor.current = otherRep
    expect((await open(f.id)).status).toBe(404)
    actor.current = rep
    expect((await open(f.id)).status).toBe(302)
  })

  it('an image with no lead (a logo) is agency-wide, and only agency-wide', async () => {
    const f = await fileRow({ type: 'image/webp', path: uploadKey(A, 'image/webp') })
    actor.current = otherRep
    expect((await open(f.id)).status).toBe(302)
    actor.current = foreignAdmin
    expect((await open(f.id)).status).toBe(404)
  })

  it('a stored type outside the allowlist is served as an opaque download', async () => {
    const f = await fileRow({ type: 'text/html' })
    actor.current = admin
    const url = lands(await open(f.id))
    expect(url.searchParams.get('response-content-type')).toBe('application/octet-stream')
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^attachment/)
  })

  it('?download=1 forces a download', async () => {
    const f = await fileRow()
    actor.current = admin
    expect(lands(await open(f.id, '?download=1')).searchParams.get('response-content-disposition')).toMatch(/^attachment/)
    expect(lands(await open(f.id)).searchParams.get('response-content-disposition')).toMatch(/^inline/)
  })

  it('a legacy row answers 410 without contacting R2', async () => {
    const f = await fileRow({ path: 'uploads/7/docs/123_old.pdf' })
    actor.current = admin
    const res = await open(f.id)
    expect(res.status).toBe(410)
    expect(send).not.toHaveBeenCalled()
  })

  it('a missing object is 404; an outage is 503; neither leaks a URL into the logs', async () => {
    const f = await fileRow()
    actor.current = admin
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }))
    expect((await open(f.id)).status).toBe(404)
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))
    expect((await open(f.id)).status).toBe(503)
    await open(f.id)
    const all = logged.join('\n')
    expect(all).not.toContain('X-Amz-Signature')
    expect(all).not.toContain(f.path)
  })

  it('canReadFile refuses another agency by itself, even for that agency’s admin', async () => {
    const f = await fileRow({ type: 'image/webp' })
    const row = await loadFileForAgency(f.id, A)
    await expect(canReadFile(foreignAdmin, row!)).resolves.toBe(false)
    await expect(canReadFile(admin, row!)).resolves.toBe(true)
  })

  it('a non-numeric id is 404', async () => {
    actor.current = admin
    expect((await open('1 OR 1=1')).status).toBe(404)
  })
})

describe('intended access is preserved', () => {
  const opens = async (who: Record<string, unknown>, id: number) => {
    actor.current = who
    return (await open(id)).status
  }
  const asPerson = (id: number, role = 'AGNT') => person(id, A, role)

  it('shared lead: a rep granted access to its owner can read its files', async () => {
    const f = await fileRow({ clientId: LEAD_A2, createdById: REP_A2 })
    expect(await opens(rep, f.id)).toBe(404)
    await db('user_perms').insert({ gaveId: REP_A2, gotId: GRANTED } as never)
    expect(await opens(asPerson(GRANTED), f.id)).toBe(302)
  })

  it('a team manager reads team members’ lead files and Excel imports; other managers do not', async () => {
    const leadFile = await fileRow({ clientId: LEAD_A, createdById: REP_A })
    const excel = await fileRow({ createdById: REP_A, type: 'application/vnd.ms-excel' })
    expect(await opens(asPerson(MANAGER, 'MNGR'), leadFile.id)).toBe(302)
    expect(await opens(asPerson(MANAGER, 'MNGR'), excel.id)).toBe(302)
    expect(await opens(asPerson(OTHER_MANAGER, 'MNGR'), leadFile.id)).toBe(404)
    expect(await opens(asPerson(OTHER_MANAGER, 'MNGR'), excel.id)).toBe(404)
  })

  it('GM has admin access inside the agency, and none outside it', async () => {
    const f = await fileRow({ clientId: LEAD_A2, createdById: REP_A2 })
    expect(await opens(person(ADMIN_A, A, 'GM'), f.id)).toBe(302)
    expect(await opens(person(ADMIN_B, B, 'GM'), f.id)).toBe(404)
  })

  it('a lead’s handler can read its files, without gaining write rules', async () => {
    const [{ id: lead }] = await db('clients').insert({ firstName: 'ה', lastName: 'נ', agencyId: A, createdById: REP_A2, userId: REP_A2, handlerId: HANDLER } as never).returning('id')
    const f = await fileRow({ clientId: lead, createdById: REP_A2 })
    expect(await opens(asPerson(HANDLER), f.id)).toBe(302)
    actor.current = asPerson(HANDLER)
    await expect(deleteFile({ id: f.id, clientId: lead })).rejects.toThrow('Forbidden')
  })

  it('a task’s assignee can read its attachment on a colleague’s lead', async () => {
    const [{ id: taskId }] = await db('tasks').insert({ clientId: LEAD_A2, title: 'משימה', userId: ASSIGNEE } as never).returning('id')
    const viaRow = await fileRow({ clientId: LEAD_A2, taskId, createdById: REP_A2 })
    const viaList = await fileRow({ clientId: LEAD_A2, createdById: REP_A2 })
    await db('tasks').where({ id: taskId }).update({ files: [viaList.id] } as never)
    expect(await opens(asPerson(ASSIGNEE), viaRow.id)).toBe(302)
    expect(await opens(asPerson(ASSIGNEE), viaList.id)).toBe(302)
    expect(await opens(rep, viaRow.id)).toBe(404)
  })

  it('a promotion or task template document is visible across the agency, not outside it', async () => {
    const promoFile = await fileRow({ createdById: ADMIN_A })
    const templateFile = await fileRow({ createdById: ADMIN_A })
    expect(await opens(rep, promoFile.id)).toBe(404)
    await db('promo').insert({ title: 'מבצע', desc: 'x', start: new Date(), end: new Date(), goals: '[]', agencyId: A, files: [promoFile.id] } as never)
    await db('task_tmplts').insert({ title: 'תבנית', agencyId: A, files: [templateFile.id] } as never)
    expect(await opens(rep, promoFile.id)).toBe(302)
    expect(await opens(rep, templateFile.id)).toBe(302)
    expect(await opens(foreignAdmin, promoFile.id)).toBe(404)
  })

  it('an image attached to a colleague’s lead does not become agency-wide', async () => {
    const f = await fileRow({ type: 'image/webp', path: uploadKey(A, 'image/webp'), clientId: LEAD_A2, createdById: REP_A2 })
    expect(await opens(rep, f.id)).toBe(404)
  })

  it('a logo opens for the agency; a rep cannot delete it', async () => {
    const logo = await fileRow({ type: 'image/webp', path: uploadKey(A, 'image/webp'), createdById: ADMIN_A })
    expect(await opens(rep, logo.id)).toBe(302)
    actor.current = rep
    await expect(deleteFile({ id: logo.id, clientId: null })).rejects.toThrow('Forbidden')
    actor.current = admin
    await deleteFile({ id: logo.id, clientId: null })
    expect(await db('files').where({ id: logo.id }).first('id')).toBeUndefined()
  })

  it('a copilot attachment registers on a lead the rep may act on, and only there', async () => {
    actor.current = rep
    const attachment = { name: 'תמונה.webp', type: 'image/webp', size: 10, path: uploadKey(A, 'image/webp') }
    send.mockResolvedValue({ ContentLength: 10, ContentType: 'image/webp' } as never)
    const [row] = await addFiles({ presigned: [attachment], clientId: LEAD_A })
    expect(await opens(rep, row.id)).toBe(302)
    await expect(addFiles({ presigned: [attachment], clientId: LEAD_A2 })).rejects.toThrow('Forbidden')
  })
})

describe('object cleanup when rows are deleted', () => {
  const deletedKeys = () =>
    send.mock.calls
      .filter((c: unknown[]) => (c[0] as object).constructor.name === 'DeleteObjectCommand')
      .map((c: unknown[]) => (c[0] as { input: { Key: string } }).input.Key)
  const newLead = async () =>
    (await db('clients').insert({ firstName: 'מ', lastName: String(Math.random()), agencyId: A, createdById: ADMIN_A, userId: ADMIN_A, lead: true } as never).returning('id'))[0].id as number

  it('deleting a lead removes its objects, including task attachments, not a shared one or a legacy path', async () => {
    const lead = await newLead()
    const [{ id: taskId }] = await db('tasks').insert({ clientId: lead, title: 'מ' } as never).returning('id')
    const direct = await fileRow({ clientId: lead })
    const onTask = await fileRow({ taskId, clientId: lead })
    // No lead on the row: the row outlives the lead (tasks have no FK to clients), so the object must too.
    const taskOnly = await fileRow({ taskId })
    const shared = await fileRow({ clientId: lead })
    await fileRow({ path: shared.path })
    const legacy = await fileRow({ clientId: lead, path: 'uploads/7/docs/old.pdf' })
    actor.current = admin
    await expect(deleteLead(lead)).resolves.toMatchObject({ success: true })
    const keys = deletedKeys()
    expect(keys).toEqual(expect.arrayContaining([direct.path, onTask.path]))
    expect(keys).not.toContain(shared.path)
    expect(keys).not.toContain(taskOnly.path)
    expect(await db('files').where({ id: taskOnly.id }).first('id')).toBeTruthy()
    expect(keys).not.toContain(legacy.path)
    expect(await db('files').whereIn('id', [direct.id, onTask.id, legacy.id]).select('id')).toEqual([])
  })

  it('a bulk delete does the same', async () => {
    const [a, b] = [await newLead(), await newLead()]
    const [fa, fb] = [await fileRow({ clientId: a }), await fileRow({ clientId: b })]
    actor.current = admin
    await expect(deleteManyLeads([a, b])).resolves.toMatchObject({ deletedCount: 2 })
    expect(deletedKeys()).toEqual(expect.arrayContaining([fa.path, fb.path]))
  })

  it('nothing is removed when the delete is refused or rolled back', async () => {
    const lead = await newLead()
    await fileRow({ clientId: lead })
    actor.current = rep
    await expect(deleteLead(lead)).resolves.toMatchObject({ error: true })
    expect(deletedKeys()).toEqual([])
  })

  it('a task’s delete removes its objects, and R2 failing does not fail the delete', async () => {
    const lead = await newLead()
    const [{ id: taskId }] = await db('tasks').insert({ clientId: lead, title: 'מ' } as never).returning('id')
    const f = await fileRow({ taskId, clientId: lead })
    actor.current = admin
    send.mockRejectedValue(Object.assign(new Error('x'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } }))
    await expect(deleteTask({ id: taskId, clientId: lead })).rejects.toThrow(/NEXT_REDIRECT|redirect/i)
    expect(deletedKeys()).toEqual([f.path])
    expect(await db('tasks').where({ id: taskId }).first('id')).toBeUndefined()
    expect(logged.some((l) => l.includes('object.delete_failed'))).toBe(true)
  })
})

describe('uploading', () => {
  const declared = (over: Record<string, unknown> = {}) => ({ name: 'דוח.pdf', type: 'application/pdf', size: 10, path: uploadKey(A, 'application/pdf'), ...over })

  it('getPresigned chooses a tenant key and keeps the customer’s filename out of it', async () => {
    actor.current = rep
    const [p] = await getPresigned({ metadat: [{ name: 'סודי מאוד.pdf', type: 'application/pdf', size: 10 }] })
    expect(p.path).toMatch(new RegExp(`^tenants/${A}/uploads/[0-9a-f-]{36}\\.pdf$`))
    expect(decodeURIComponent(p.url)).not.toContain('סודי')
  })

  it.each([
    [{ name: 'x.html', type: 'text/html', size: 10 }],
    [{ name: 'x.svg', type: 'image/svg+xml', size: 10 }],
    [{ name: 'x.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }],
    [{ name: 'x.pdf', type: 'application/pdf', size: 0 }],
  ])('getPresigned refuses %j', async (meta) => {
    actor.current = rep
    await expect(getPresigned({ metadat: [meta] })).rejects.toThrow()
    expect(logged.some((l) => l.includes('upload.refused'))).toBe(true)
  })

  it('registers a verified upload, and logs completion without the filename', async () => {
    actor.current = rep
    const [row] = await addFiles({ presigned: [declared()], clientId: LEAD_A })
    expect(row).toMatchObject({ agencyId: A, clientId: LEAD_A, createdById: REP_A, name: 'דוח.pdf' })
    expect(row.url).toBe(`/api/files/${row.id}`)
    const line = logged.find((l) => l.includes('upload.completed'))!
    expect(line).not.toContain('דוח')
  })

  it('cannot claim another tenant’s object: the attack the key check exists for', async () => {
    actor.current = foreignAdmin
    await expect(addFiles({ presigned: [declared()], clientId: null })).rejects.toThrow('Forbidden')
    expect(send).not.toHaveBeenCalled()
  })

  it('cannot attach to a lead the user may not act on', async () => {
    actor.current = rep
    await expect(addFiles({ presigned: [declared()], clientId: LEAD_A2 })).rejects.toThrow('Forbidden')
    actor.current = foreignAdmin
    await expect(addFiles({ presigned: [declared({ path: uploadKey(B, 'application/pdf') })], clientId: LEAD_A })).rejects.toThrow('Forbidden')
  })

  it('ignores anything else the browser sends', async () => {
    actor.current = rep
    const [row] = await addFiles({ presigned: [declared({ agencyId: B, createdById: ADMIN_B, id: 424242, url: 'https://evil.example' })], clientId: LEAD_A })
    expect(row).toMatchObject({ agencyId: A, createdById: REP_A })
    expect(row.id).not.toBe(424242)
  })

  it('an object that is not what was declared is deleted and refused', async () => {
    actor.current = rep
    send.mockResolvedValueOnce({ ContentLength: 10, ContentType: 'text/html' } as never).mockResolvedValueOnce({} as never)
    await expect(addFiles({ presigned: [declared()], clientId: LEAD_A })).rejects.toThrow('Forbidden')
    expect((send.mock.calls[1][0] as object).constructor.name).toBe('DeleteObjectCommand')
    expect(await db('files').where({ name: 'דוח.pdf', type: 'text/html' }).first()).toBeUndefined()
  })

  it('an object that never arrived cannot be registered', async () => {
    actor.current = rep
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }))
    await expect(addFiles({ presigned: [declared()], clientId: LEAD_A })).rejects.toThrow()
  })

  it('template file saves apply the same ownership rule', async () => {
    actor.current = foreignAdmin
    await expect(saveFilesTmplt([{ name: 'x.pdf', path: uploadKey(A, 'application/pdf'), size: 1, type: 'application/pdf' }])).rejects.toThrow('Invalid file')
  })
})

describe('deleting', () => {
  const commands = () => send.mock.calls.map((c) => (c[0] as object).constructor.name)

  it('removes the object with the last row, not while another row shares it', async () => {
    const path = uploadKey(A, 'application/pdf')
    const first = await fileRow({ path })
    const second = await fileRow({ path })
    actor.current = admin
    await deleteFile({ id: first.id, clientId: null })
    expect(commands()).not.toContain('DeleteObjectCommand')
    await deleteFile({ id: second.id, clientId: null })
    expect(commands()).toContain('DeleteObjectCommand')
  })

  it('a rep cannot delete a file they cannot read', async () => {
    const f = await fileRow({ clientId: LEAD_A2, createdById: REP_A2 })
    actor.current = rep
    await expect(deleteFile({ id: f.id, clientId: LEAD_A2 })).rejects.toThrow('Forbidden')
    expect(await db('files').where({ id: f.id }).first('id')).toBeTruthy()
  })

  it('a legacy row is removed without contacting R2', async () => {
    const f = await fileRow({ path: 'uploads/7/docs/old.pdf' })
    actor.current = admin
    await deleteFile({ id: f.id, clientId: null })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the migration', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const migration = require('../../migrations/20261105120000_files_url_app_route.cjs')
  const expression = async () =>
    (await db.raw(`SELECT pg_get_expr(d.adbin, d.adrelid) AS e FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'files'::regclass AND a.attname = 'url'`)).rows[0].e as string

  it('runs in knex’s transaction, with a lock timeout, so a failure changes nothing', () => {
    expect(migration.config?.transaction).not.toBe(false)
    const source = require('node:fs').readFileSync('migrations/20261105120000_files_url_app_route.cjs', 'utf8')
    expect(source).toContain(`SET LOCAL lock_timeout`)
    expect(source).not.toMatch(/SET SESSION|\bCASCADE\b.*DROP|DROP COLUMN[^`]*CASCADE/)
  })

  it('a concurrent insert gets a working url after the swap (generated from the assigned id)', async () => {
    const a = await fileRow()
    const b = await fileRow()
    expect([a.url, b.url]).toEqual([`/api/files/${a.id}`, `/api/files/${b.id}`])
    expect(b.id).toBeGreaterThan(a.id)
  })

  it('applies forward, keeps file rows, retires AWS documents, and reverses to what was there', async () => {
    const f = await fileRow({ path: 'uploads/7/docs/keep.pdf' })
    await db.transaction(async (trx) => {
      // The ledger row alone is under test here, so the invoice FK is switched off locally.
      await trx.raw(`SET LOCAL session_replication_role = replica`)
      await trx('bill_documents').insert([
        { agencyId: A, invoiceId: 900001, status: 'ready', isCurrent: true, url: 'https://socialcrm-storage.s3.eu-north-1.amazonaws.com/bill/1.pdf', path: 'bill/1.pdf' },
        { agencyId: A, invoiceId: 900002, status: 'rendering', isCurrent: false, url: 'https://socialcrm-storage.s3.eu-north-1.amazonaws.com/bill/2.pdf', path: 'bill/2.pdf' },
        { agencyId: A, invoiceId: 900003, status: 'ready', isCurrent: true, url: '/api/billing/invoice/900003/download', path: 'tenants/1/invoices/3/x.pdf' },
      ] as never)
    })

    // The chain has already run. Down restores the baseline's bucket expression…
    await migration.down(db)
    expect(await expression()).toContain('allin-storage')
    expect((await db('files').where({ id: f.id }).first('path')).path).toBe('uploads/7/docs/keep.pdf')

    // …and up moves off it again.
    await migration.up(db)
    expect(await expression()).toContain('/api/files/')
    const row = await db('files').where({ id: f.id }).first('url', 'path')
    expect(row).toEqual({ url: `/api/files/${f.id}`, path: 'uploads/7/docs/keep.pdf' })

    const doc = (invoiceId: number) => db('bill_documents').where({ invoiceId }).first('status', 'isCurrent', 'errorReason')
    expect(await doc(900001)).toEqual({ status: 'failed', isCurrent: false, errorReason: 'legacy_storage_retired' })
    expect(await doc(900002)).toEqual({ status: 'failed', isCurrent: false, errorReason: 'legacy_render_abandoned' })
    expect(await doc(900003)).toEqual({ status: 'ready', isCurrent: true, errorReason: null })

    await migration.down(db)
    expect(await doc(900001)).toEqual({ status: 'ready', isCurrent: true, errorReason: null })
    expect(await doc(900002)).toEqual({ status: 'rendering', isCurrent: false, errorReason: null })
    await migration.up(db)
  })
})
