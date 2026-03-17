import { db } from '@/config/db'

export async function _flat_sales() {
  await db.raw(`
      DROP VIEW IF EXISTS _flat_sales;
      CREATE OR REPLACE VIEW _flat_sales AS
      SELECT
        su."userId",
        u.name,
        su."cmsn",
        s.branch,
        s."prdctType",
        su.amount,
        s.company,
        s.status,
        s."offrDt",
        s.action,
        s.prdct,
        s.replace,
        s.replace        AS "isUpgrade",
        s."clientId",
        su.tfuca,
        su.tfuca         AS "annualValue",
        s."agencyId",
        s."saleDt"
      FROM users u
      JOIN sale_users su ON u.id = su."userId"
      JOIN sales s ON su."saleId" = s.id`)
}

export async function _sales() {
  await db.raw(`
      DROP VIEW IF EXISTS _sales;
      CREATE OR REPLACE VIEW _sales AS
      SELECT
          s.*,
          s.rwrd           AS bonus,
          s.replace        AS "isUpgrade",
          s.renew          AS "isRenewal",
          s."polisaNum"    AS "contractNum",
          s."polisaEndDt"  AS "contractEndDate",
          c.details AS "clientData",
          ru.name AS "handlerName",
          SUM(su."monthlyCmsn") as "monthlyCmsn",
          SUM(su."yearlyCmsn") as "yearlyCmsn",
          SUM(su."agencyMonthlyCmsn") as "agencyMonthlyCmsn",
          SUM(su."agencyYearlyCmsn") as "agencyYearlyCmsn",
          SUM(su."mngrMonthlyCmsn") as "mngrMonthlyCmsn",
          SUM(su."mngrYearlyCmsn") as "mngrYearlyCmsn",
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

export async function _teams() {
  await db.schema.raw(`
    DROP VIEW IF EXISTS _teams;
      CREATE OR REPLACE VIEW "_teams" AS
      SELECT
        t.id,
        t.name,
        t."agencyId",
        t."updatedAt",
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id', u.id, 'name', u.name) ORDER BY u.name
          ) FILTER (WHERE ut.type = 'user' AND u.id IS NOT NULL),
          '[]'
        ) as users,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id', u.id, 'name', u.name) ORDER BY u.name
          ) FILTER (WHERE ut.type = 'mngr' AND u.id IS NOT NULL),
          '[]'
        ) as mngrs,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id', u.id, 'name', u.name) ORDER BY u.name
          ) FILTER (WHERE ut.type = 'office' AND u.id IS NOT NULL),
          '[]'
        ) as offices,
        COALESCE(
          ARRAY_AGG(u.id) FILTER (WHERE ut.type = 'user' AND u.id IS NOT NULL),
          '{}'
        ) as "userIds",
        COALESCE(
          ARRAY_AGG(u.id) FILTER (WHERE ut.type = 'mngr' AND u.id IS NOT NULL),
          '{}'
        ) as "mngrIds",
        COALESCE(
          ARRAY_AGG(u.id) FILTER (WHERE ut.type = 'office' AND u.id IS NOT NULL),
          '{}'
        ) as "officeIds"
      FROM teams t
      LEFT JOIN user_teams ut ON t.id = ut."teamId"
      LEFT JOIN users u ON ut."userId" = u.id
      GROUP BY t.id
    `)
}
