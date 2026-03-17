import { db } from "@/config/db"

async function run() {

    await db.raw(`
        drop function if exists _flat_sales_summary;
        drop function if exists _get_agnt_perm;
        drop function if exists _get_mngr_perm;
        drop function if exists _get_office_perm;
        drop function if exists _total_grps;
        drop function if exists _total_sales;
        drop function if exists _total_sum;
        `)

  console.log('done')
  db.destroy()
}

run()
