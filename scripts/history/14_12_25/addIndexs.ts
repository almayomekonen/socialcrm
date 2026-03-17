import { db } from '@/config/db'

async function addIndices() {
  console.log('Starting optimized index creation...')

  try {
    // 1. SALES TABLE
    await db.schema.table('sales', (table) => {
      // COMPOSITE ANCHOR INDEX:
      // Most queries filter by Agency AND Date range.
      // Putting agencyId first groups all agency data together.
      table.index(['agencyId', 'offrDt'], 'idx_sales_agency_date')

      // HIGH CARDINALITY LOOKUP:
      // Critical for "Show me history for Client X"
      table.index(['clientId'], 'idx_sales_client_id')

      // SEARCH/SORT OPTIMIZATION:
      // Useful for global searches or "Recently Updated" views
      table.index(['updatedAt'], 'idx_sales_updated_at')

      // NOTE:
      // - Removed 'status': Low cardinality.
      // - Removed 'branch', 'prdctType': Postgres can filter these in memory after using the Agency/Date index.
    })
    console.log('Indices added to "sales".')

    // 2. SALE_USERS TABLE
    await db.schema.table('sale_users', (table) => {
      // FOREIGN KEY / FILTER:
      // Critical for filtering "My Sales"
      table.index(['userId'], 'idx_sale_users_user_id')

      // JOIN PERFORMANCE:
      // Critical for joining back to the sales table
      table.index(['saleId'], 'idx_sale_users_sale_id')
    })
    console.log('Indices added to "sale_users".')

    // 3. USERS TABLE
    await db.schema.table('users', (table) => {
      // Filter users by agency (e.g. for dropdowns)
      table.index(['agencyId'], 'idx_users_agency_id')
    })
    console.log('Indices added to "users".')
  } catch (error) {
    console.error('Error adding indices:', error)
  } finally {
    await db.destroy()
  }
}

addIndices()
