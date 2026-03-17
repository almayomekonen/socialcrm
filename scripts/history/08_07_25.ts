import { omit } from '@/lib/funcs'
import { db } from '@/config/db'

async function run() {
  // STEP 1
  // await db.schema.alterTable('users', (table) => {
  //   table.specificType('gotGrpPerm', 'integer[]')
  // })

  // STEP 2
  // await db.schema.dropViewIfExists('_office_user_tbl')
  // await db.schema.dropViewIfExists('_users_tbl')

  // STEP 3
  // await db.raw(`drop view _sales;`)
  // await db.raw(`create or replace view _sales as
  // SELECT
  //   s.*,
  //   c.details AS "clientData",
  //   CASE
  //       WHEN "agnt2Id" IS NOT NULL THEN
  //         CONCAT(a.name, '(', "agntShare", '%) & ', a2.name, '(', "agnt2Share", '%)')
  //       WHEN "otherAgnt" IS NOT NULL THEN
  //         CONCAT(a.name, '(', "agntShare", '%) & ', "otherAgnt", '(', "agnt2Share", '%)')
  //       ELSE a.name
  //     END AS "agntName",
  //     ru.name AS resp_name
  // FROM sales s
  // LEFT JOIN clients c ON "clientId" = c.id
  // LEFT JOIN users a ON "agntId" = a.id
  // LEFT JOIN users a2 ON "agnt2Id" = a2.id
  // LEFT JOIN users ru ON s."respId" = ru.id`)

  // STEP 3.5
  // await db.schema.dropViewIfExists('_all_users')

  // STEP 4
  // const users = await db('office_users').whereNotIn('id', [140, 148, 151, 152, 153, 156])
  // for (const user of users as any) {
  //   user.gotPerm = user.userIds_perm
  //   user.gotGrpPerm = user.grp_ids_perm
  //   user.gglName = user.gglname
  //   user.gglSub = user.gglsub
  //   omit(user, ['userIds_perm', 'grp_ids_perm', 'gglname', 'gglsub', 'name'])
  //     //   await db('users').insert(user)
  // }

  // STEP 5
  // await db.schema.dropTable('office_users')

  db.destroy()
}

run()

// STEP 6
// CREATE OR REPLACE FUNCTION _get_office_perm(p_user_id INT)
// RETURNS JSON AS $$
// DECLARE
//     user_grp_ids INT[] := '{}';
//     user_userIds INT[] := '{}';
//     group_mngrIds INT[] := '{}';
//     group_userIds INT[] := '{}';
//     agnts JSON;
//     grps JSON;
//     got_perm INT[];
//     ids INT[];
// BEGIN

//     SELECT COALESCE("gotGrpPerm", '{}'), COALESCE("gotPerm", '{}')
//     INTO user_grp_ids, user_userIds
//     FROM users
//     WHERE id = p_user_id;

//     -- Get mngrIds and userIds from grps where user_grp_ids matches
//     SELECT
//         COALESCE(ARRAY_AGG(DISTINCT unnested_mngr), '{}'),
//         COALESCE(ARRAY_AGG(DISTINCT unnested_agnt), '{}')
//     INTO group_mngrIds, group_userIds
//     FROM grps,
//         UNNEST(mngrIds) AS unnested_mngr,
//         UNNEST(userIds) AS unnested_agnt
//     WHERE id = ANY(user_grp_ids);

//     ids := ARRAY(SELECT DISTINCT UNNEST(user_userIds || group_mngrIds || group_userIds || ARRAY[p_user_id]));

//     -- AGNTS NAMES
//     SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('id', id, 'name', name) ORDER BY name), '[]')
//     INTO agnts
//     FROM users
//     WHERE id = ANY(ids);

//     -- GRP NAMES
//     SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT('id', id, 'name', name) ORDER BY name), '[]')
//     INTO grps
//     FROM grps
//     WHERE id = ANY(user_grp_ids);

//     -- Return final JSON object
//     RETURN JSON_BUILD_OBJECT(
//         'gotPermIds', ids,
//         'grps', grps,
//         'gotPerm', agnts,
//         'inGrpPerm', agnts
//     );

// END;
// $$ LANGUAGE plpgsql;
