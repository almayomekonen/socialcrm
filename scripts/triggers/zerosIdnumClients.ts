import { db } from '@/config/db'

async function run() {
  await addZeroesToIdNumTrigger()

  console.log('Done')
  db.destroy()
}

run()

async function addZeroesToIdNumTrigger() {
  await db.raw(`
    CREATE OR REPLACE FUNCTION add_zeros_to_idnum()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW."idNum" IS NOT NULL THEN
        NEW."idNum" := LPAD(NEW."idNum", 9, '0');
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.raw(`
    CREATE TRIGGER add_zeros_trigger
    BEFORE INSERT OR UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION add_zeros_to_idnum();
  `)
}
