import { db } from '@/config/db'

const idLength = 8

async function run() {
  // starting at tz with 5 digits
  const clientsdig = await db('clients').whereRaw('LENGTH("idNum") = ' + idLength)

  console.log(
    'before',
    clientsdig.map((c) => c.idNum),
  )

  const updated = await db('clients')
    .whereRaw('LENGTH("idNum") = ' + idLength)
    .update({ idNum: db.raw('\'0\' || "idNum"') })
    .returning('idNum')

  console.log('after', updated)

  console.log('Done')
  db.destroy()
}

run()
