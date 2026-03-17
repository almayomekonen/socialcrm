import { db } from '@/config/db'

async function run() {
  await createUserInfoTrigger()
  await createClientInfoTrigger()

  console.log('done')
  db.destroy()
}

run()

async function createUserInfoTrigger() {
  await db.raw(`
        DROP TRIGGER IF EXISTS user_info_insert_trigger ON users;
      `)

  await db.raw(`
        DROP FUNCTION IF EXISTS create_user_info_entry();
      `)

  await db.raw(`
    CREATE OR REPLACE FUNCTION create_user_info_entry()
      RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO users_info (id)
      VALUES (NEW.id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.raw(`
    CREATE TRIGGER user_info_insert_trigger
      AFTER INSERT ON users
      FOR EACH ROW
      EXECUTE FUNCTION create_user_info_entry();
  `)
}

async function createClientInfoTrigger() {
  await db.raw(`
        DROP TRIGGER IF EXISTS client_info_insert_trigger ON clients;
      `)

  await db.raw(`
        DROP FUNCTION IF EXISTS create_client_info_entry();
      `)
  await db.raw(`
        CREATE OR REPLACE FUNCTION create_client_info_entry()
          RETURNS TRIGGER AS $$
        BEGIN
          -- 'NEW.id' refers to the 'id' of the row just inserted into the 'clients' table
          INSERT INTO clients_info (id)
          VALUES (NEW.id);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `)

  await db.raw(`
        CREATE TRIGGER client_info_insert_trigger
          AFTER INSERT ON clients
          FOR EACH ROW
          EXECUTE FUNCTION create_client_info_entry();
      `)
}
