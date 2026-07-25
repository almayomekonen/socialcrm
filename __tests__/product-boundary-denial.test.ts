/**
 * Server-boundary denial tests: representative PRODUCT server actions across
 * domains must throw ProductAccessError for a CONFIRMED NEVER_STARTED /
 * TRIAL_EXPIRED session — proving the requireProductAccess() gate fires at the
 * real action boundary, before any DB/product work. Identity + trial reads are
 * mocked; the guard throws before the action touches the (stubbed) db.
 *
 * Allow-side (PAID/TRIAL_ACTIVE/LEGACY return the user) is covered by the guard
 * unit tests in product-access-gate.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const trial = { row: undefined as unknown }
// Unique agencyId per call so React cache() in getAgencyProductAccess never
// memoizes a stale trial state across cases.
let agencySeq = 5000
vi.mock('@/db/trial', () => ({ getAgencyTrial: () => Promise.resolve(trial.row) }))
vi.mock('@/db/auth', () => ({
  getUser: () => Promise.resolve({ id: 7, agencyId: ++agencySeq, suspended: false }),
}))
// Stub infra the action modules import so the guard is reached; the guard throws
// before any of these are used on the deny path.
vi.mock('@/config/db', () => ({ db: new Proxy(() => {}, { get: () => () => {} }) }))
vi.mock('@/db/agencies', () => ({ getAgencyId: () => Promise.resolve(4242) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('next/navigation', () => ({ redirect: () => {} }))

import { ProductAccessError } from '@/lib/requireUser'
import { deleteTask, createTask } from '@/actions/tasks'
import { deleteLead } from '@/actions/clients'
import { deleteFile } from '@/actions/files'
import { deleteDeal } from '@/actions/salesTbl'
import { deleteUser } from '@/actions/usersNteams'
import { addSavedFilters } from '@/actions/filter'
import { deletePromo } from '@/actions/promos'

const DAY = 86_400_000
const NOW = Date.now()
const NEVER_STARTED = { plan: 'free', trialExempt: false, trialStartedAt: null, trialEndsAt: null }
const TRIAL_EXPIRED = { plan: 'free', trialExempt: false, trialStartedAt: new Date(NOW - 8 * DAY), trialEndsAt: new Date(NOW - DAY) }

// (action, argsThunk) — args are placeholders; the gate throws before they matter.
// Gate-first product actions across domains (auth/access is the first body
// statement — no input validation precedes it).
const BOUNDARIES: [string, () => Promise<unknown>][] = [
  ['tasks.deleteTask', () => deleteTask({ id: 1, clientId: 1 })],
  ['tasks.createTask (user boundary, separated from webhook primitive)', () => createTask({ clientId: 1, title: 't' })],
  ['clients.deleteLead', () => deleteLead(1)],
  ['files.deleteFile', () => deleteFile({ id: 1, clientId: 1 } as never)],
  ['salesTbl.deleteDeal', () => deleteDeal(1)],
  ['usersNteams.deleteUser', () => deleteUser(1 as never)],
  ['filter.addSavedFilters', () => addSavedFilters({ id: 1 } as never)],
  ['promos.deletePromo', () => deletePromo(1 as never)],
]

beforeEach(() => {
  trial.row = undefined
})

describe('NEVER_STARTED → every product boundary denies', () => {
  it.each(BOUNDARIES)('%s throws ProductAccessError(trial-not-started)', async (_n, call) => {
    trial.row = NEVER_STARTED
    await expect(call()).rejects.toMatchObject({ name: 'ProductAccessError', reason: 'trial-not-started' })
  })
})

describe('TRIAL_EXPIRED → every product boundary denies', () => {
  it.each(BOUNDARIES)('%s throws ProductAccessError(subscription-required)', async (_n, call) => {
    trial.row = TRIAL_EXPIRED
    await expect(call()).rejects.toMatchObject({ name: 'ProductAccessError', reason: 'subscription-required' })
  })
})

describe('sanity: ProductAccessError is a distinct error type', () => {
  it('is thrown, not a generic Error', async () => {
    trial.row = NEVER_STARTED
    await expect(deleteTask({ id: 1, clientId: 1 })).rejects.toBeInstanceOf(ProductAccessError)
  })
})
