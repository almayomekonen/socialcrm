import ContractForm from '@/components/contracts/ContractForm'
import ContractPrdctsForm from '@/components/contracts/ContractPrdctsForm'
import { getContractById, getContractPrdcts, getContracts } from '@/db/contracts'
import { getUsers } from '@/db/usersNTeams'
import { Btn } from '@/lib/btns/Btn'
import Link from 'next/link'

export default async function ContractsPage({ params }) {
  const { contractId } = await params

  const contract = await getContractById(contractId)
  if (!contract) return <div>חוזה לא נמצא</div>
  const contractPrdcts = await getContractPrdcts(contractId)

  const users = await getUsers({ withOfficeUsers: true, withExtUsers: true })
  const contracts = await getContracts()
  return (
    <div>
      <Btn variant='ghost' className='w-24' href={`/settings/edit_contracts`} lbl='חזרה לחוזים' icon='arrow-right' />
      <div className='card mt-2'>
        <ContractForm contracts={contracts} users={users} contract={contract} />
      </div>
      <ContractPrdctsForm contract={contract} contractPrdcts={contractPrdcts} />
    </div>
  )
}
