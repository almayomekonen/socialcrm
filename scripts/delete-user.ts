/**
 * Hard-delete a user's ENTIRE tenant: the user, their agency, every other user
 * in that agency, and every row referencing any of them — all in one transaction.
 *
 * SAFE BY DEFAULT: it's a dry run unless you pass --confirm. It prints the target
 * database, the agency, EVERY user in that agency, and the full blast radius first,
 * so you can confirm this is an isolated test tenant before anything is deleted.
 *
 * Uses a standalone connection from DATABASE_URL (it does NOT import config/db,
 * which is pinned to .env.local/localhost), so you can point it at prod explicitly.
 *
 *   Dry run:  DATABASE_URL='<PROD_URL>' npx tsx scripts/delete-user.ts almayomekonen6@gmail.com
 *   Delete:   DATABASE_URL='<PROD_URL>' npx tsx scripts/delete-user.ts almayomekonen6@gmail.com --confirm
 *
 * If a child table has its own non-cascading dependents, the transaction ROLLS
 * BACK with the blocking table named — nothing is partially deleted.
 */
import { Client } from 'pg'

const email = (process.argv[2] ?? '').toLowerCase().trim()
const confirm = process.argv.includes('--confirm')

type Fk = { table_name: string; column_name: string }

async function fksReferencing(client: Client, refTable: string): Promise<Fk[]> {
  const { rows } = await client.query(
    `
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_name = $1 and ccu.column_name = 'id'
    order by tc.table_name, kcu.column_name
  `,
    [refTable],
  )
  return rows as Fk[]
}

async function main() {
  if (!email) throw new Error('Usage: delete-user.ts <email> [--confirm]')
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Set DATABASE_URL to the target database')

  const isLocal = /localhost|127\.0\.0\.1/.test(url)
  const client = new Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: info } = await client.query('select current_database() as db, inet_server_addr() as host')
    console.log(`Target DB: ${info[0].db} @ ${info[0].host ?? 'local socket'}`)

    const { rows: matches } = await client.query(
      'select id, email, "agencyId" from users where lower(email) = $1',
      [email],
    )
    if (matches.length === 0) {
      console.log('No user with that email — nothing to do.')
      return
    }
    if (matches.length > 1) {
      console.log('Refusing: more than one user matches that email.', matches)
      return
    }
    const target = matches[0]
    const agencyId = target.agencyId
    console.log('Target user:', target)
    console.log('Agency to wipe:', agencyId)

    const { rows: agencyUsers } = await client.query(
      'select id, email from users where "agencyId" = $1 order by id',
      [agencyId],
    )
    const userIds = agencyUsers.map((u) => u.id)
    console.log(`\nUsers in this agency (${agencyUsers.length}) — ALL will be deleted:`)
    for (const u of agencyUsers) console.log(`  ${u.id}  ${u.email}`)

    // FKs to users(id) (children of any user) and to agencies(id) (tenant data).
    // Exclude the users table itself from both loops — users are deleted explicitly.
    const userFks = (await fksReferencing(client, 'users')).filter((f) => f.table_name !== 'users')
    const agencyFks = (await fksReferencing(client, 'agencies')).filter((f) => f.table_name !== 'users')

    console.log('\nRows referencing these users:')
    for (const fk of userFks) {
      const { rows } = await client.query(
        `select count(*)::int as n from "${fk.table_name}" where "${fk.column_name}" = any($1::int[])`,
        [userIds],
      )
      if (rows[0].n) console.log(`  ${fk.table_name}.${fk.column_name}: ${rows[0].n}`)
    }
    console.log('Rows referencing this agency:')
    for (const fk of agencyFks) {
      const { rows } = await client.query(
        `select count(*)::int as n from "${fk.table_name}" where "${fk.column_name}" = $1`,
        [agencyId],
      )
      if (rows[0].n) console.log(`  ${fk.table_name}.${fk.column_name}: ${rows[0].n}`)
    }

    if (!confirm) {
      console.log('\nDRY RUN — nothing deleted. Re-run with --confirm to delete (transactional).')
      return
    }

    console.log('\n--confirm set. Deleting the whole tenant in a transaction…')
    await client.query('BEGIN')
    try {
      for (const fk of userFks) {
        const r = await client.query(
          `delete from "${fk.table_name}" where "${fk.column_name}" = any($1::int[])`,
          [userIds],
        )
        if (r.rowCount) console.log(`  deleted ${r.rowCount} from ${fk.table_name} (by ${fk.column_name})`)
      }
      for (const fk of agencyFks) {
        const r = await client.query(`delete from "${fk.table_name}" where "${fk.column_name}" = $1`, [agencyId])
        if (r.rowCount) console.log(`  deleted ${r.rowCount} from ${fk.table_name} (by ${fk.column_name})`)
      }
      const ru = await client.query('delete from users where "agencyId" = $1', [agencyId])
      console.log(`  deleted ${ru.rowCount} from users`)
      const ra = await client.query('delete from agencies where id = $1', [agencyId])
      console.log(`  deleted ${ra.rowCount} from agencies`)
      await client.query('COMMIT')
      console.log('COMMITTED. Tenant hard-deleted.')
    } catch (e) {
      await client.query('ROLLBACK')
      console.error('ROLLED BACK (no changes applied):', (e as Error).message)
      process.exitCode = 1
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
