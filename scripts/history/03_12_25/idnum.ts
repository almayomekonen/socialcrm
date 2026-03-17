import { db } from '@/config/db'
import { _sales } from '../../views/views'

async function run() {
  await db.raw('DROP VIEW IF EXISTS _sales')
  await db.raw('ALTER TABLE clients DROP COLUMN details')

  await db.raw('ALTER TABLE clients ALTER COLUMN "idNum" TYPE TEXT USING "idNum"::TEXT')

  await db.raw(`
    ALTER TABLE clients
    ADD COLUMN details TEXT GENERATED ALWAYS AS (
      "firstName" || ' ' || "lastName" || ' (' || "idNum" || ')'
    ) STORED
  `)

  await _sales()

  // --------------------------------------------------

  const result = await db('clients')
    .whereRaw('LENGTH("idNum") = 8')
    .update({ idNum: db.raw('\'0\' || "idNum"') })

  console.log('Updated rows:', result)

  // const clnts = await db('clients').whereBetween('idNum', [100000, 999999]).select('idNum')
  // console.log('sales', clnts)

  // console.log(isIdNumValid(443762))

  console.log('Done')
  db.destroy()
}

run()

// { count: '4462' }
// { count: '4517' }

function isIdNumValid(id: string | number): boolean {
  id = id?.toString()?.trim()
  if (!id || id.length > 9 || isNaN(Number(id)) || Number(id) <= 0) return false
  id = id.padStart(9, '0')

  let sum = 0
  for (let i = 0; i < 9; i++) {
    let digit = Number(id[i])
    let weight = i % 2 === 0 ? 1 : 2
    let product = digit * weight
    sum += product > 9 ? product - 9 : product
  }

  return sum % 10 === 0
}
