import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * REGRESSION GUARD — every `ON CONFLICT` must have an inferable arbiter.
 *
 * B7 shipped the connection identity index as a PARTIAL unique index
 * (`WHERE "externalId" IS NOT NULL`). Postgres only infers a partial index as
 * the ON CONFLICT arbiter when the statement repeats that predicate, and Knex
 * emits none — so every attempt to provision a connection failed in production
 * with 42P10 `infer_arbiter_indexes`.
 *
 * The index was correct as a CONSTRAINT and wrong as an ARBITER, which is why
 * no test caught it: the schema was valid, the code was valid, and only their
 * combination was not. This test checks the combination.
 *
 * It is static on purpose. The DB-backed suites cannot run here, and a bug
 * that only appears when real SQL meets a real index needs a check that does
 * not depend on either being reachable.
 */

const ROOT = process.cwd()

/** Where an `onConflict([...])` lives, and which table it writes to. */
const CALL_SITES: { file: string; table: string; columns: string[] }[] = [
  {
    file: 'actions/automations/connections.ts',
    table: 'automation_connections',
    columns: ['agencyId', 'integrationKey', 'externalId'],
  },
  {
    file: 'lib/automations/connectors/contactForm7.ts',
    table: 'automation_sources',
    columns: ['connectionRowId', 'externalId'],
  },
  {
    file: 'db/automations/sourceLabels.ts',
    table: 'automation_source_labels',
    columns: ['agencyId', 'connectionId', 'sourceId'],
  },
]

/**
 * Only the `up` half of each migration. A `down` that restores an older shape
 * is not what production runs, and reading it would make this guard report the
 * rollback state as if it were live — which is exactly the mistake that would
 * hide the next occurrence of this bug.
 */
const migrationSql = (): string =>
  fs
    .readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.cjs'))
    .sort()
    .map((f) => {
      const src = fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')
      const down = src.search(/exports\.down\s*=/)
      return down === -1 ? src : src.slice(0, down)
    })
    .join('\n')

const normalise = (cols: string) =>
  cols
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .sort()
    .join(',')

type Arbiter = { table: string; columns: string; partial: boolean }

/**
 * Every unique arbiter the migrations declare, in file order — so an index
 * that is later dropped and recreated is read at its FINAL shape, which is
 * exactly what production ends up with.
 */
function declaredArbiters(): Arbiter[] {
  const sql = migrationSql()
  const found: Arbiter[] = []

  // CREATE UNIQUE INDEX [IF NOT EXISTS] name ON table (cols) [WHERE …]
  const indexRe =
    /CREATE\s+UNIQUE\s+INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?\s+\S+\s+ON\s+([A-Za-z_0-9."]+)\s*\(([^)]+)\)([^;`]*)/gi
  for (const m of sql.matchAll(indexRe)) {
    found.push({
      table: m[1].replace(/^public\./, '').replace(/"/g, ''),
      columns: normalise(m[2]),
      partial: /\bWHERE\b/i.test(m[3] ?? ''),
    })
  }

  // PRIMARY KEY ("a", "b") inside a CREATE TABLE — always a valid arbiter.
  const tableRe = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z_0-9."]+)\s*\(([\s\S]*?)\n\s*\)/gi
  for (const t of sql.matchAll(tableRe)) {
    const table = t[1].replace(/^public\./, '').replace(/"/g, '')
    for (const pk of (t[2] ?? '').matchAll(/PRIMARY\s+KEY\s*\(([^)]+)\)/gi)) {
      found.push({ table, columns: normalise(pk[1]), partial: false })
    }
  }

  return found
}

describe('every automations ON CONFLICT has an inferable arbiter', () => {
  const arbiters = declaredArbiters()

  it('the migration scan finds arbiters at all', () => {
    expect(arbiters.length).toBeGreaterThan(0)
  })

  it('every call site still targets the columns this test claims', () => {
    for (const site of CALL_SITES) {
      const src = fs.readFileSync(path.join(ROOT, site.file), 'utf8')
      const literal = site.columns.map((c) => `'${c}'`).join(', ')
      expect(src, `${site.file} no longer uses onConflict([${literal}])`).toContain(`onConflict([${literal}])`)
    }
  })

  for (const site of CALL_SITES) {
    it(`${site.table} — a UNIQUE arbiter exists for (${site.columns.join(', ')})`, () => {
      const wanted = normalise(site.columns.join(','))
      const matches = arbiters.filter((a) => a.table === site.table && a.columns === wanted)
      expect(matches.length, `no unique index or primary key on ${site.table}(${wanted})`).toBeGreaterThan(0)
    })

    it(`${site.table} — that arbiter is NOT partial (the 42P10 bug)`, () => {
      const wanted = normalise(site.columns.join(','))
      const matches = arbiters.filter((a) => a.table === site.table && a.columns === wanted)
      // The LAST declaration wins: an index dropped and recreated by a later
      // migration is what production actually has.
      const final = matches[matches.length - 1]
      expect(
        final?.partial,
        `${site.table}(${wanted}) is a PARTIAL unique index — Postgres cannot infer it as an ON CONFLICT arbiter without a matching WHERE, and Knex emits none`,
      ).toBe(false)
    })
  }
})

describe('the guard actually catches the bug it was written for', () => {
  it('recognises a partial unique index as partial', () => {
    const sql = `CREATE UNIQUE INDEX IF NOT EXISTS x_idx ON t ("a", "b") WHERE "b" IS NOT NULL`
    const m = /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\S+\s+ON\s+\S+\s*\(([^)]+)\)([^;`]*)/i.exec(sql)!
    expect(/\bWHERE\b/i.test(m[2])).toBe(true)
  })

  it('recognises a plain unique index as inferable', () => {
    const sql = `CREATE UNIQUE INDEX IF NOT EXISTS x_idx ON t ("a", "b")`
    const m = /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\S+\s+ON\s+\S+\s*\(([^)]+)\)([^;`]*)/i.exec(sql)!
    expect(/\bWHERE\b/i.test(m[2] ?? '')).toBe(false)
  })
})
