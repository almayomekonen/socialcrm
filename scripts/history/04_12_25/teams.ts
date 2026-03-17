import { db } from '@/config/db'

async function run() {
  await createTeamsView()
  console.log('Done')
  db.destroy()
}

run()

async function createTeamsView() {
  await db.schema.raw(`
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
