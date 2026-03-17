import { db } from '@/config/db'

export async function run() {
  const tablesToTrigger = ['clients']

  for (const tableName of tablesToTrigger) {
    await db.raw(`
      CREATE TRIGGER set_timestamp
      BEFORE UPDATE ON public.${tableName}
      FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();
    `)
  }

  console.log('Done')
  db.destroy()
}

run()
