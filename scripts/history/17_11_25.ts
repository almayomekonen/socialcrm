import { db } from '@/config/db'

async function run() {
  // const sales = await db('sales').whereNotIn('prdct', bigList).select('prdct').distinct()

  // const sales = await db('sales').where({ branch: 'אלמנטרי' }).whereRaw('EXTRACT(YEAR FROM "offrDt") < 2025')
  // console.log('sales', sales)

  // .select('prdctType')
  // .distinct()
  // .whereNotIn('prdctType', ['פרמיה חד פעמית', 'חדש', 'חידוש', 'תוספות לפוליסה'])

  // const res = await db('sales').where({ branch: 'אלמנטרי', prdctType: 'תוספת לפוליסה' }).update({ prdctType: 'תוספות לפוליסה' })

  // const res = await db('sales').where({ branch: 'אלמנטרי', prdct: 'חובה' }).update({ prdct: 'רכב חובה' })

  // const res = await db('sales').where({ branch: 'אלמנטרי', prdct: 'מקיף' }).update({ prdct: 'רכב מקיף' })

  // const res = await db('sales').where({ branch: 'אלמנטרי', prdct: 'מבנה' }).update({ prdct: 'דירה מבנה' })

  const res = await db('sales').where({ branch: 'אלמנטרי', prdct: 'צד ג' }).update({ prdct: 'רכב צד ג' })
  console.log('res', res)

  console.log('Done')
  db.destroy()
}

run()

// function adjustPrdctName(prdct: string) {
//   const arr = [
//     { prdct: 'חובה', newPrdct: 'רכב חובה' },
//     { prdct: 'מבנה', newPrdct: 'דירה מבנה' },
//     { prdct: 'מקיף', newPrdct: 'רכב מקיף' },
//     { prdct: 'צד ג', newPrdct: 'רכב צד ג' },
//   ]
//   const item = arr.find((item) => item.prdct === prdct)
//   return item?.newPrdct
// }
