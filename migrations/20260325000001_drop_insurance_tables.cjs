/**
 * Migration: drop_insurance_tables
 *
 * Drops legacy insurance-related tables that have ZERO references in the
 * application codebase. Verified by full grep audit on 2026-03-25.
 *
 * Tables removed:
 *   bankim        — bank accounts (insurance)
 *   bit_prdcts    — Bit insurance products
 *   bituchim      — insurance policies
 *   halvaot       — loans
 *   neyarotErech  — securities / bonds
 *   savings       — savings products
 *   qna           — Q&A (insurance questionnaire)
 *   requests      — insurance requests / XML exchange
 *   tiny_urls     — URL shortener (unused)
 *
 * Table NOT removed (actively used):
 *   cmsn_rules — commission rules, used in saleForm, uploadSales, calc_commission page
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // Drop in an order that respects FK dependencies:
  // All these tables reference clients/users/agencies but not each other,
  // so IF cascade is not available we still drop cleanly in this order.
  // Using CASCADE to handle any remaining FK references automatically.

  const tables = [
    'requests', // FK → clients, users, agencies
    'qna', // FK → clients
    'savings', // FK → clients
    'neyarotErech', // FK → clients
    'halvaot', // FK → clients
    'bituchim', // FK → clients
    'bit_prdcts', // FK → clients
    'bankim', // FK → clients
    'tiny_urls', // no FK
  ]

  for (const table of tables) {
    await knex.schema.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`)
  }
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  // Intentionally not restoring these tables.
  // They are legacy insurance tables with no active usage.
  // To restore, re-run the original schema creation scripts from git history.
  throw new Error(
    'down() is intentionally not implemented for drop_insurance_tables. ' + 'These tables are legacy and should not be restored.',
  )
}
