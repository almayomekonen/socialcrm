/**
 * Run all seeds in order:
 *   npx tsx scripts/seeds/seed_all.ts
 *
 * Or run individually:
 *   npx tsx scripts/seeds/seed_clients.ts
 *   npx tsx scripts/seeds/seed_sales.ts
 *   npx tsx scripts/seeds/seed_tasks.ts
 *   npx tsx scripts/seeds/seed_campaigns.ts
 */

import { execSync } from 'child_process'

const seeds = [
  'seed_clients.ts',
  'seed_sales.ts',
  'seed_tasks.ts',
  'seed_campaigns.ts',
]

for (const seed of seeds) {
  console.log(`\n▶ Running ${seed}...`)
  execSync(`npx tsx scripts/seeds/${seed}`, { stdio: 'inherit' })
}

console.log('\n🎉 All seeds complete!')
