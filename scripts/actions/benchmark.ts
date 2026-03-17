import { db } from '@/config/db'

async function benchmark() {
  console.log('Running benchmark...')

  // This matches the main dashboard query structure from db/salesTbl.ts
  // Adjust the 'agencyId' to a real ID from your database for accurate results
  const benchmarkQuery = `
    EXPLAIN ANALYZE
    SELECT * FROM sales
    WHERE "agencyId" = 1
    AND "offrDt" BETWEEN '2024-01-01' AND '2024-12-31'
    ORDER BY "updatedAt" DESC
    LIMIT 100;
  `

  try {
    const res = await db.raw(benchmarkQuery)

    // The output of EXPLAIN ANALYZE is a series of query plan lines.
    // The last few lines usually contain "Execution Time".
    res.rows.forEach((row: any) => {
      console.log(row['QUERY PLAN'])
    })
  } catch (error) {
    console.error('Benchmark failed:', error)
  } finally {
    await db.destroy()
  }
}

benchmark()
