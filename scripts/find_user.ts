import { db } from '@/config/db'

async function main() {
  // Check _sales view definition
  const salesView = await db.raw(`
    SELECT table_name, view_definition
    FROM information_schema.views
    WHERE table_name = '_sales'
  `)
  console.log('_sales view:', JSON.stringify(salesView.rows, null, 2))

  // Check sales table columns
  const salesCols = await db.raw(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'sales'
    ORDER BY ordinal_position
  `)
  console.log('\nsales table columns:', JSON.stringify(salesCols.rows, null, 2))

  // Check clients table columns
  const clientCols = await db.raw(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'clients'
    ORDER BY ordinal_position
  `)
  console.log('\nclients table columns:', JSON.stringify(clientCols.rows, null, 2))

  // Check sales count for agency 3
  const salesCount = await db('sales').where('agencyId', 3).count('id').first()
  console.log('\nsales count for agency 3:', salesCount)

  // Check if any sales linked to fasika leads
  const fasikaLeads = await db('clients').where('agencyId', 3).select('id')
  const leadIds = fasikaLeads.map((l) => l.id)
  const linkedSales = await db('sales').whereIn('clientId', leadIds).count('id').first()
  console.log('sales linked to fasika leads:', linkedSales)

  await db.destroy()
}

main()
