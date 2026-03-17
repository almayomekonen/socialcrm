import { getUser } from '@/db/auth'
import { getPerms, getPermsAndFilter } from '@/db/filter'
import GeneralTable from '@/components/sumSales/GeneralTable'
import { getTablePref } from '@/db/salesTbl'
import { getSumBranchesByTeams } from '@/db/sumSales'
import { isMngr, Roles } from '@/types/roles'

export default async function TeamsPage({ searchParams }) {
  const user = await getUser()
  if (!isMngr(user.role)) return <h1 className='title'>אין לך הרשאות לצפייה בסיכום צוותים</h1>

  // TODO: remove this - is just for enabling the filters
  user.role = Roles.GM

  let { filter } = await searchParams
  const { sqlFilter, rawFilter, gotPermTeams } = await getPermsAndFilter({ user, filter })

  const tblData = await getSumBranchesByTeams(sqlFilter)
  const tblPref = await getTablePref()

  return (
    <div>
      <GeneralTable
        data={tblData}
        tblPref={tblPref}
        user={user}
        tblId='groupsTable251'
        filterProps={{ teams: gotPermTeams, rawFilter, users: null }}
        key={Math.random()}
      />
    </div>
  )
}
