/**
 * conversation_ai_state — the persisted AiState vocabulary must match the code.
 *
 * WHY THIS TEST EXISTS. The `AiState` union and the CHECK constraint that
 * persists it live in two files that nothing forces to agree. When they drifted
 * once before, `markClosed()` wrote a value the constraint forbade and nothing
 * caught it: every test that exercises the close lifecycle mocks
 * `@/db/conversationAiState`, so the writer's SQL never runs. A seventh state
 * added tomorrow would slip through exactly the same gap.
 *
 * So this asserts at the SQL level, with no database: the set of string literals
 * in the `AiState` union must equal the set the newest migration persists. It
 * reads the migration's REAL emitted SQL — by running `up` against a recording
 * stub — rather than pattern-matching the source, so a migration that builds its
 * statement differently is still checked on what it actually executes.
 *
 * TARGET: `20260818235900_conversation_ai_state_closed.cjs`, the migration that
 * owns the current vocabulary. There is deliberately no second closed-state
 * migration; this test is what keeps the one that exists honest.
 *
 * Per project memory `project_db_integration_harness_blocker`, SQL-level
 * assertions are the established workaround while the DB harness is down.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const MIGRATIONS_DIR = join(ROOT, 'migrations')
const QUALIFICATION_SRC = join(ROOT, 'lib', 'inbox', 'autoresponse', 'qualification.ts')

/** Created the table and its original (pre-`closed`) CHECK. */
const CREATE_MIGRATION = '20260625000001_create_conversation_ai_state.cjs'
/** Owns the current vocabulary. */
const VOCABULARY_MIGRATION = '20260818235900_conversation_ai_state_closed.cjs'

// ── Code side: the AiState union ─────────────────────────────────────────────

function aiStateUnionMembers(): string[] {
  const src = readFileSync(QUALIFICATION_SRC, 'utf8')
  // Handles both the multi-line `| 'x'` form and a single-line union.
  const block = src.match(/export type AiState\s*=\s*([\s\S]*?)(?=\n\s*\n|\nexport )/)
  expect(block, 'could not locate the AiState union in qualification.ts').not.toBeNull()
  const members = [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  expect(members.length, 'AiState union parsed as empty').toBeGreaterThan(0)
  return members
}

// ── SQL side: what the migrations actually persist ───────────────────────────

/** Migration files that define a CHECK over conversation_ai_state."aiState". */
function constraintMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.cjs'))
    .filter((f) => {
      const src = readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
      return src.includes('conversation_ai_state') && /CHECK\s*\(\s*"aiState"\s+IN/.test(src)
    })
    .sort()
}

/**
 * Run a migration's `up` against a recording stub and return every statement.
 * Awaited, not fire-and-forget: each `await knex.raw(...)` yields a microtask, so
 * a synchronous read would capture only the first statement.
 */
async function emittedSql(file: string): Promise<string[]> {
  const statements: string[] = []
  const knex = Object.assign(
    () => ({ where: () => ({ update: async () => 1 }) }),
    {
      raw: async (sql: string) => {
        statements.push(sql)
        return { rows: [] }
      },
      schema: { hasColumn: async () => false },
    },
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(join(MIGRATIONS_DIR, file)) as { up: (k: unknown) => Promise<void> }
  await mod.up(knex)
  return statements
}

/** The values inside `CHECK ("aiState" IN (...))` for the given statements. */
function allowedValues(statements: string[]): string[] {
  const stmt = statements.find((s) => /CHECK\s*\(\s*"aiState"\s+IN\s*\(/.test(s))
  expect(stmt, 'no aiState CHECK statement was emitted').toBeDefined()
  const inList = stmt!.match(/CHECK\s*\(\s*"aiState"\s+IN\s*\(([^)]*)\)/)
  expect(inList, 'could not parse the IN list').not.toBeNull()
  return [...inList![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

const newestConstraintMigration = (): string => {
  const files = constraintMigrations()
  expect(files.length, 'no migration defines the aiState CHECK').toBeGreaterThan(0)
  return files[files.length - 1]
}

// ── Assertions ───────────────────────────────────────────────────────────────

describe('the persisted aiState vocabulary matches the AiState union', () => {
  it('the newest aiState-constraint migration is the expected one', () => {
    // Guards against a duplicate closed-state migration being reintroduced: if a
    // newer one appears, this test must be retargeted deliberately, not silently.
    expect(newestConstraintMigration()).toBe(VOCABULARY_MIGRATION)
  })

  it('every AiState union member is allowed by the constraint', async () => {
    // The drift this file exists for: a state in the union, absent from SQL.
    const union = aiStateUnionMembers()
    const allowed = allowedValues(await emittedSql(VOCABULARY_MIGRATION))
    const missing = union.filter((s) => !allowed.includes(s))
    expect(missing, `AiState value(s) with no persisted constraint entry: ${missing.join(', ')}`).toEqual([])
  })

  it('the constraint allows nothing the union does not declare', async () => {
    // Drift in the other direction: SQL that permits a state no code can produce.
    const union = aiStateUnionMembers()
    const allowed = allowedValues(await emittedSql(VOCABULARY_MIGRATION))
    const extra = allowed.filter((s) => !union.includes(s))
    expect(extra, `constraint permits state(s) absent from AiState: ${extra.join(', ')}`).toEqual([])
  })

  it("includes 'closed' specifically, the state markClosed() writes", async () => {
    expect(allowedValues(await emittedSql(VOCABULARY_MIGRATION))).toContain('closed')
  })

  it('never narrows: every originally-allowed value survives', async () => {
    // 'dormant' is unused by any writer today but is still declared; dropping an
    // allowed value would be a narrowing change no migration here intends.
    const original = allowedValues(await emittedSql(CREATE_MIGRATION))
    const current = allowedValues(await emittedSql(VOCABULARY_MIGRATION))
    const dropped = original.filter((s) => !current.includes(s))
    expect(dropped, `constraint no longer allows: ${dropped.join(', ')}`).toEqual([])
    expect(current).toContain('dormant')
  })
})

describe('the vocabulary migration replaces the old constraint safely', () => {
  const code = (): string =>
    readFileSync(join(MIGRATIONS_DIR, VOCABULARY_MIGRATION), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  it('discovers the existing constraint at runtime rather than hardcoding a name', () => {
    // The original CHECK is inline in CREATE TABLE, so Postgres auto-named it from
    // the mixed-case column — a name that needs quoting and is not guaranteed
    // identical across environments.
    expect(code()).toContain('pg_constraint')
    expect(code()).toMatch(/DROP CONSTRAINT/)
  })

  it('drops the old constraint before adding the new one', async () => {
    const up = await emittedSql(VOCABULARY_MIGRATION)
    const dropIdx = up.findIndex((s) => s.includes('DROP CONSTRAINT'))
    const addIdx = up.findIndex((s) => s.includes('ADD CONSTRAINT'))
    expect(dropIdx).toBeGreaterThan(-1)
    expect(addIdx).toBeGreaterThan(dropIdx)
  })

  it('is the only closed-state migration in the tree', () => {
    // A second one would drop and re-add a byte-equivalent constraint for nothing.
    const closedMigrations = readdirSync(MIGRATIONS_DIR).filter(
      (f) => f.endsWith('.cjs') && /closed/i.test(f) && f.includes('conversation_ai_state'),
    )
    expect(closedMigrations).toEqual([VOCABULARY_MIGRATION])
  })
})
