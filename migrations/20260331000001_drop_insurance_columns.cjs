/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // Drop _sales view first — it references monthlyCmsn and other columns being dropped
  await knex.raw('DROP VIEW IF EXISTS _sales')

  // Drop insurance commission columns from sale_users (all were zero across all rows)
  await knex.schema.alterTable('sale_users', (table) => {
    table.dropColumn('monthlyCmsn')
    table.dropColumn('yearlyCmsn')
    table.dropColumn('agencyMonthlyCmsn')
    table.dropColumn('agencyYearlyCmsn')
    table.dropColumn('mngrMonthlyCmsn')
    table.dropColumn('mngrYearlyCmsn')
  })

  // Drop insurance policy columns from sales (all were null across all rows)
  await knex.schema.alterTable('sales', (table) => {
    table.dropColumn('polisaNum')
    table.dropColumn('polisaEndDt')
    table.dropColumn('renew')
  })

  // Recreate _sales view without the dropped columns
  await knex.raw(`
    CREATE OR REPLACE VIEW _sales AS
    SELECT
        s.*,
        s.rwrd           AS bonus,
        s.replace        AS "isUpgrade",
        c.details AS "clientData",
        ru.name AS "handlerName",
        CASE
          WHEN COUNT(su."userId") > 1 THEN
              STRING_AGG(CONCAT(u.name, '(', su.prcnt, '%)'), ' & ' ORDER BY su.prcnt DESC)
          ELSE MAX(u.name)
        END AS "userName",
        ARRAY_AGG(su."userId") AS "userIds",
        ARRAY_AGG(su.prcnt) AS "userPrcnts"
      FROM sales s
      LEFT JOIN clients c ON "clientId" = c.id
      LEFT JOIN sale_users su ON s.id = su."saleId"
      LEFT JOIN users u ON su."userId" = u.id
      LEFT JOIN users ru ON s."handlerId" = ru.id
      GROUP BY s.id, c.details, ru.name
      ORDER BY s."updatedAt" DESC
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('sale_users', (table) => {
    table.decimal('monthlyCmsn').nullable()
    table.decimal('yearlyCmsn').nullable()
    table.decimal('agencyMonthlyCmsn').nullable()
    table.decimal('agencyYearlyCmsn').nullable()
    table.decimal('mngrMonthlyCmsn').nullable()
    table.decimal('mngrYearlyCmsn').nullable()
  })

  await knex.schema.alterTable('sales', (table) => {
    table.string('polisaNum').nullable()
    table.date('polisaEndDt').nullable()
    table.boolean('renew').nullable()
  })
}
