/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // _sales view depends on clients.details — drop it first, restore after
  await knex.raw(`DROP VIEW IF EXISTS _sales;`)

  await knex.raw(`ALTER TABLE clients DROP COLUMN IF EXISTS details;`)

  await knex.raw(`
    ALTER TABLE clients ADD COLUMN details text GENERATED ALWAYS AS (
      COALESCE("firstName", '') || ' ' || COALESCE("lastName", '') ||
      CASE WHEN "idNum" IS NOT NULL THEN ' (' || "idNum" || ')' ELSE '' END
    ) STORED;
  `)

  await knex.raw(`
    CREATE VIEW _sales AS
    SELECT
      s.id, s.status, s.action, s.company, s.branch, s.prdct, s."prdctType",
      s."saleDt", s."offrDt", s."clientId", s."createdAt", s."updatedAt",
      s."createdById", s.notes, s."otherAgnt", s."favSalesId",
      s.amount, s.cmsn, s.replace, s."handlerId", s."leadSource",
      s.rwrd, s.tfuca, s."agencyId", s."bizNum", s."bizName",
      s.rwrd AS bonus,
      s.replace AS "isUpgrade",
      c.details AS "clientData",
      ru.name AS "handlerName",
      CASE
        WHEN count(su."userId") > 1
          THEN string_agg(concat(u.name, '(', su.prcnt, '%)'), ' & ' ORDER BY su.prcnt DESC)
        ELSE max(u.name)
      END AS "userName",
      array_agg(su."userId") AS "userIds",
      array_agg(su.prcnt) AS "userPrcnts"
    FROM sales s
    LEFT JOIN clients c ON s."clientId" = c.id
    LEFT JOIN sale_users su ON s.id = su."saleId"
    LEFT JOIN users u ON su."userId" = u.id
    LEFT JOIN users ru ON s."handlerId" = ru.id
    GROUP BY s.id, c.details, ru.name
    ORDER BY s."updatedAt" DESC;
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP VIEW IF EXISTS _sales;`)

  await knex.raw(`ALTER TABLE clients DROP COLUMN IF EXISTS details;`)

  await knex.raw(`
    ALTER TABLE clients ADD COLUMN details text GENERATED ALWAYS AS (
      (((("firstName" || ' '::text) || "lastName") || ' ('::text) || "idNum") || ')'::text
    ) STORED;
  `)

  await knex.raw(`
    CREATE VIEW _sales AS
    SELECT
      s.id, s.status, s.action, s.company, s.branch, s.prdct, s."prdctType",
      s."saleDt", s."offrDt", s."clientId", s."createdAt", s."updatedAt",
      s."createdById", s.notes, s."otherAgnt", s."favSalesId",
      s.amount, s.cmsn, s.replace, s."handlerId", s."leadSource",
      s.rwrd, s.tfuca, s."agencyId", s."bizNum", s."bizName",
      s.rwrd AS bonus,
      s.replace AS "isUpgrade",
      c.details AS "clientData",
      ru.name AS "handlerName",
      CASE
        WHEN count(su."userId") > 1
          THEN string_agg(concat(u.name, '(', su.prcnt, '%)'), ' & ' ORDER BY su.prcnt DESC)
        ELSE max(u.name)
      END AS "userName",
      array_agg(su."userId") AS "userIds",
      array_agg(su.prcnt) AS "userPrcnts"
    FROM sales s
    LEFT JOIN clients c ON s."clientId" = c.id
    LEFT JOIN sale_users su ON s.id = su."saleId"
    LEFT JOIN users u ON su."userId" = u.id
    LEFT JOIN users ru ON s."handlerId" = ru.id
    GROUP BY s.id, c.details, ru.name
    ORDER BY s."updatedAt" DESC;
  `)
}
