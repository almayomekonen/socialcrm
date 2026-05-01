import { db } from '../config/db'

const TARGET_EMAIL = 'alamayo274@gmail.com'

const TOUCHED_TABLES = [
  'users',
  'clients',
  'agencies',
  'sales',
  'contracts',
  'teams',
  'files',
  'promo',
  'cmsn_rules',
  'payments',
  'task_tmplts',
  'invitations',
  'user_perms',
  'default_settings',
  'users_info',
  'sale_users',
  'tasks',
  'client_lists',
  'user_teams',
]

async function run() {
  const normalized = TARGET_EMAIL.trim().toLowerCase()

  const user = await db('users').whereILike('email', normalized).first()
  const invitationsByEmail = await db('invitations')
    .whereILike('email', normalized)
    .select('id', 'email', 'createdById', 'expiresAt')

  console.log('--- DISCOVERY ---')
  console.log('Target email (normalized):', normalized)
  console.log('User row:', user ? { id: user.id, agencyId: user.agencyId, role: user.role } : 'none')
  console.log(`Pending invitations matching email: ${invitationsByEmail.length}`)

  if (!user && invitationsByEmail.length === 0) {
    console.log('\nNothing to delete. Exiting.')
    await db.destroy()
    return
  }

  if (user) {
    const fkMap = await db.raw(
      `
      SELECT
        conname                                AS constraint_name,
        conrelid::regclass::text               AS dependent_table,
        a.attname                              AS dependent_column,
        confrelid::regclass::text              AS referenced_table,
        CASE confdeltype
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
        END                                    AS delete_rule
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f'
        AND (
          confrelid::regclass::text = ANY(?) OR
          conrelid::regclass::text  = ANY(?)
        )
      ORDER BY referenced_table, delete_rule, dependent_table, dependent_column
    `,
      [TOUCHED_TABLES, TOUCHED_TABLES],
    )
    console.log('\nFK dependencies (both directions, within touched table set):')
    for (const row of fkMap.rows) {
      console.log(`  ${row.dependent_table}.${row.dependent_column} -> ${row.referenced_table} [${row.delete_rule}]`)
    }
  }

  console.log('\n--- DELETING (transactional) ---')

  await db.transaction(async (trx) => {
    if (invitationsByEmail.length > 0) {
      const n = await trx('invitations').whereILike('email', normalized).delete()
      console.log(`invitations (by email): ${n}`)
    }

    if (!user) return

    const userId = user.id as number
    const agencyId = user.agencyId as number | null

    const perms = await trx('user_perms').where('gaveId', userId).orWhere('gotId', userId).delete()
    console.log(`user_perms (target user): ${perms}`)

    const settings = await trx('default_settings').where({ userId }).delete()
    console.log(`default_settings (target user): ${settings}`)

    const info = await trx('users_info').where({ id: userId }).delete()
    console.log(`users_info (target user): ${info}`)

    if (!agencyId) {
      const u = await trx('users').where({ id: userId }).delete()
      console.log(`users (single row, no agency): ${u}`)
      return
    }

    const agencyUserIds = (await trx('users').where({ agencyId }).select('id')).map((r: any) => r.id)
    const clientIds = (await trx('clients').where({ agencyId }).select('id')).map((r: any) => r.id)
    const saleIds = (await trx('sales').where({ agencyId }).select('id')).map((r: any) => r.id)
    console.log(`agency ${agencyId}: ${agencyUserIds.length} users, ${clientIds.length} clients, ${saleIds.length} sales`)

    if (saleIds.length > 0) {
      const n = await trx('sale_users').whereIn('saleId', saleIds).delete()
      console.log(`sale_users: ${n}`)
    }
    const sales = await trx('sales').where({ agencyId }).delete()
    console.log(`sales: ${sales}`)

    if (clientIds.length > 0) {
      const n = await trx('tasks').whereIn('clientId', clientIds).delete()
      console.log(`tasks: ${n}`)
    }
    const clients = await trx('clients').where({ agencyId }).delete()
    console.log(`clients: ${clients}`)

    if (agencyUserIds.length > 0) {
      const cl = await trx('client_lists').whereIn('userId', agencyUserIds).delete()
      console.log(`client_lists (all agency users): ${cl}`)

      const inv = await trx('invitations').whereIn('createdById', agencyUserIds).delete()
      console.log(`invitations (issued by any agency user): ${inv}`)
    }

    const promo = await trx('promo').where({ agencyId }).delete()
    console.log(`promo: ${promo}`)

    const contractIds = (await trx('contracts').where({ agencyId }).select('id')).map((r: any) => r.id)
    if (contractIds.length > 0) {
      const cp = await trx('contract_prdcts').whereIn('contractId', contractIds).delete()
      console.log(`contract_prdcts: ${cp}`)
    }
    const contracts = await trx('contracts').where({ agencyId }).delete()
    console.log(`contracts: ${contracts}`)

    const cmsn = await trx('cmsn_rules').where({ agencyId }).delete()
    console.log(`cmsn_rules: ${cmsn}`)

    const payments = await trx('payments').where({ agencyId }).delete()
    console.log(`payments: ${payments}`)

    const tmplts = await trx('task_tmplts').where({ agencyId }).delete()
    console.log(`task_tmplts: ${tmplts}`)

    if (agencyUserIds.length > 0) {
      const ut = await trx('user_teams').whereIn('userId', agencyUserIds).delete()
      console.log(`user_teams: ${ut}`)
    }
    const teams = await trx('teams').where({ agencyId }).delete()
    console.log(`teams: ${teams}`)

    await trx('agencies').where({ id: agencyId }).update({ img: null })
    console.log(`agencies.img: nulled (breaks circular FK with files)`)

    const files = await trx('files').where({ agencyId }).delete()
    console.log(`files: ${files}`)

    const agencyUsers = await trx('users').where({ agencyId }).delete()
    console.log(`users (agency-scoped): ${agencyUsers}`)

    const agencies = await trx('agencies').where({ id: agencyId }).delete()
    console.log(`agencies: ${agencies}`)
  })

  console.log('\nDone.')
  await db.destroy()
}

run().catch(async (e) => {
  console.error('FAILED:', e)
  try {
    await db.destroy()
  } catch {}
  process.exit(1)
})
