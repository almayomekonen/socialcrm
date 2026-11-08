import dotenv from 'dotenv'
import { assertSafeToRun } from './safety'

/** The safety proof comes first: the standard setup below drops the whole schema it is pointed at. */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: '.env.test', override: true })
  assertSafeToRun(process.env)
  const { default: standard } = await import('../../globalSetup')
  await standard()
}
