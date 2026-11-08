import { HarnessRefused } from '../quote/safety'

/**
 * Hard limits on what a run can ask of R2, one per kind of operation. An attempt
 * counts against its limit whether or not it works; only a completed operation
 * counts as done. Each kind stops on its own, so hitting the upload limit cannot
 * also block the cleanup that follows it. Pure.
 */

export type R2Kind = 'upload' | 'delete' | 'read' | 'list'
export type R2Limits = { uploads: number; deletes: number; reads: number; lists: number; objects: number }
type PerKind = Record<R2Kind, number>
export type R2State = { attempts: PerKind; completed: PerKind; refused: PerKind; objectsCreated: number }

const ENV_NAMES: Record<keyof R2Limits, string> = {
  uploads: 'QUOTE_CLOUD_MAX_R2_UPLOADS',
  deletes: 'QUOTE_CLOUD_MAX_R2_DELETES',
  reads: 'QUOTE_CLOUD_MAX_R2_READS',
  lists: 'QUOTE_CLOUD_MAX_R2_LISTS',
  objects: 'QUOTE_CLOUD_MAX_R2_OBJECTS',
}

/** The planned run, measured: 14 uploads, 14 deletes, 22 reads, 5 listings, 14 objects. Each ceiling is that plus a small margin. */
export const R2_CEILING: R2Limits = { uploads: 16, deletes: 16, reads: 26, lists: 8, objects: 16 }
const LIMIT_OF: Record<R2Kind, keyof R2Limits> = { upload: 'uploads', delete: 'deletes', read: 'reads', list: 'lists' }

export function readR2Limits(source: Record<string, string | undefined>, ceiling: R2Limits = R2_CEILING): R2Limits {
  const read = (key: keyof R2Limits) => {
    const raw = source[ENV_NAMES[key]]?.trim()
    if (!raw || !/^\d+$/.test(raw)) throw new HarnessRefused(`${ENV_NAMES[key]} is required and must be a whole number`)
    const n = Number(raw)
    if (n < 1 || n > ceiling[key]) throw new HarnessRefused(`${ENV_NAMES[key]} must be from 1 to ${ceiling[key]}`)
    return n
  }
  return { uploads: read('uploads'), deletes: read('deletes'), reads: read('reads'), lists: read('lists'), objects: read('objects') }
}

/** The limits as environment values: what a dry run uses unless the guard suite tightens one. */
export const r2LimitDefaults = (env: Record<string, string | undefined>, ceiling: R2Limits = R2_CEILING) =>
  Object.fromEntries((Object.keys(ENV_NAMES) as (keyof R2Limits)[]).map((k) => [ENV_NAMES[k], env[ENV_NAMES[k]] ?? String(ceiling[k])]))

const COMMAND_KIND: Record<string, R2Kind> = {
  PutObjectCommand: 'upload',
  DeleteObjectCommand: 'delete',
  GetObjectCommand: 'read',
  HeadObjectCommand: 'read',
  ListObjectsV2Command: 'list',
}
export const kindOfCommand = (name: string): R2Kind | null => COMMAND_KIND[name] ?? null

export function createR2Counter(limits: R2Limits) {
  const zero = (): PerKind => ({ upload: 0, delete: 0, read: 0, list: 0 })
  const state: R2State = { attempts: zero(), completed: zero(), refused: zero(), objectsCreated: 0 }
  const created = new Set<string>()
  const inFlight = new Set<string>()

  return {
    state,
    /** Before the operation leaves the machine. Throws over a limit. */
    begin(kind: R2Kind, key?: string): void {
      const overKind = state.attempts[kind] >= limits[LIMIT_OF[kind]]
      const overObjects = kind === 'upload' && key !== undefined && !created.has(key) && created.size + inFlight.size >= limits.objects
      if (overKind || overObjects) {
        state.refused[kind]++
        throw new HarnessRefused(`the R2 ${overObjects ? 'object' : kind} limit for this run`)
      }
      state.attempts[kind]++
      if (kind === 'upload' && key !== undefined) inFlight.add(key)
    },
    succeed(kind: R2Kind, key?: string): void {
      state.completed[kind]++
      if (kind === 'upload' && key !== undefined) {
        inFlight.delete(key)
        created.add(key)
        state.objectsCreated = created.size
      }
    },
    fail(kind: R2Kind, key?: string): void {
      if (kind === 'upload' && key !== undefined) inFlight.delete(key)
    },
  }
}
