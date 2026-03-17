import { db } from '@/config/db'
import axios from 'axios'

async function run() {
  await tblPref()

  console.log('Done')
  db.destroy()
}
run()

const baseUrl = 'https://www.allin.org.il'
// const baseUrl = 'http://localhost:3000'

export async function tblPref() {
  await db('users').update({ tblPref: null })
  await axios.post(`${baseUrl}/api/revalidateTag`, { tag: 'users' })
  const tblPref = await db('users').whereNotNull('tblPref').select('id', 'name')
  console.log('tblPref', tblPref)
}
