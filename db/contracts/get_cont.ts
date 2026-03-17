import { db } from '@/config/db'
import { WithSql } from '@/types/global'

export async function getSumCont({ sql }: WithSql) {
  sql
    .table('_flat_sales')
    .sum('monthlyCmsn as נפרעים')
    .sum('yearlyCmsn as היקף')
    .sum('mngrMonthlyCmsn as נפרעים מפקח')
    .sum('mngrYearlyCmsn as היקף מפקח')
    .sum('agencyMonthlyCmsn as נפרעים סוכנות')
    .sum('agencyYearlyCmsn as היקף סוכנות')

  return sql
}

async function getUserConts({ cntrctWhere, user }) {
  const agntCntrcts = await db.raw(`
    SELECT 
    SUM("agntMonthlyCmsn") as "נפרעים",
    SUM("agntYearlyCmsn") as "היקף"
    FROM sales s ${cntrctWhere} AND "userId"=ANY(ARRAY[${user.id}]::INT[])`)

  return agntCntrcts.rows[0]
}

async function getAdminCntrcts({ cntrctWhere, where, user }) {
  const agncyCntracts = await db.raw(`
    SELECT 
    SUM("monthlyCmsn") as "נפרעים סוכנות",
    SUM("yearlyCmsn") as "היקף סוכנות"
    FROM sales s ${where}`)

  return agncyCntracts.rows[0]
}

async function getMngrCntrcts({ cntrctWhere, where, user }) {
  const agncyCntracts = await db.raw(`
    SELECT 
    SUM("mngrMonthlyCmsn") as "נפרעים מפקח",
    SUM("mngrYearlyCmsn") as "היקף מפקח"
    FROM sales s ${where}`)

  return agncyCntracts.rows[0]
}
