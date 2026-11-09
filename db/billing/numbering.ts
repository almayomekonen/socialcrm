import type { Knex } from 'knex'
import type { NumberingKind } from '@/lib/billing/numbering'

/**
 * Gap-free legal numbering allocation.
 *
 * The single legitimate concurrency primitive for legal document numbering.
 * Caller MUST pass an active transaction — the row lock is the serialization
 * point; using `db` directly would defeat the guarantee.
 *
 * Flow:
 *   1. INSERT ... ON CONFLICT DO NOTHING — ensures the sequence row exists.
 *   2. SELECT ... FOR UPDATE — locks the row for the duration of the txn.
 *   3. UPDATE — increments nextValue, stamps lastIssuedAt/updatedAt.
 *   4. Return the value that was allocated (the old nextValue).
 *
 * If the surrounding transaction rolls back, the increment rolls back with
 * it. That is the gap-free guarantee. Postgres SEQUENCEs cannot offer it
 * because they don't roll back on transaction abort — this row-locked
 * counter does.
 *
 * Concurrency: a second caller targeting the same (agency, year, kind)
 * blocks on the row lock until the first transaction commits or aborts.
 * Practically invisible at small-business scale; a serialization point at
 * extreme concurrency, which the data spec accepts.
 */

/**
 * A sequence row's kind. `quote` shares this allocator for a DISPLAY number
 * (sales_quotes.quoteNumber); it is a separate row per (agency, year, kind), so
 * invoice and receipt numbering are unaffected. `NumberingKind` stays the legal
 * set — nothing that formats or issues a legal document accepts `quote`.
 */
export type SequenceKind = NumberingKind | 'quote'

export type AllocateNumberOptions = {
  agencyId: number
  year: number
  kind: SequenceKind
}

export type BillNumberingSequenceRow = {
  agencyId: number
  year: number
  kind: SequenceKind
  nextValue: number
  lastIssuedAt: string | null
  createdAt: string
  updatedAt: string
}

export async function allocateNumberInTransaction(
  trx: Knex.Transaction,
  opts: AllocateNumberOptions,
): Promise<number> {
  const { agencyId, year, kind } = opts

  if (!Number.isInteger(agencyId) || agencyId <= 0) {
    throw new Error('billing.numbering.invalid_agency')
  }
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('billing.numbering.invalid_year')
  }
  if (kind !== 'invoice' && kind !== 'receipt' && kind !== 'quote') {
    throw new Error('billing.numbering.invalid_kind')
  }

  await trx.raw(
    `
    INSERT INTO bill_numbering_sequences ("agencyId", year, kind, "nextValue")
    VALUES (?, ?, ?, 1)
    ON CONFLICT ("agencyId", year, kind) DO NOTHING
    `,
    [agencyId, year, kind],
  )

  const locked = await trx('bill_numbering_sequences')
    .where({ agencyId, year, kind })
    .forUpdate()
    .first('nextValue')

  if (!locked) throw new Error('billing.numbering.row_missing')

  const allocated = Number(locked.nextValue)

  await trx('bill_numbering_sequences').where({ agencyId, year, kind }).update({
    nextValue: allocated + 1,
    lastIssuedAt: trx.fn.now(),
    updatedAt: trx.fn.now(),
  })

  return allocated
}

/**
 * Read-only peek at the next value. Does NOT lock or allocate. For diagnostic
 * surfaces only — never use this to "preview" a number that the user will see
 * before issuance, because the value is racy.
 */
export async function peekNextNumber(
  trx: Knex | Knex.Transaction,
  opts: AllocateNumberOptions,
): Promise<number> {
  const row = await trx('bill_numbering_sequences')
    .where({ agencyId: opts.agencyId, year: opts.year, kind: opts.kind })
    .first('nextValue')
  return row ? Number(row.nextValue) : 1
}
