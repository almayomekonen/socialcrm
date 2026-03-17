import ContractForm from '@/components/contracts/ContractForm'
import DeleteContractButton from '@/components/contracts/DeleteContractButton'
import { db } from '@/config/db'
import { getContracts } from '@/db/contracts'
import { getUsers } from '@/db/usersNTeams'
import { Btn } from '@/lib/btns/Btn'

export default async function ContractsPage() {
  const contracts = await getContracts()
  console.log('contracts:" ')

  const users = await getUsers({ withOfficeUsers: true, withExtUsers: true })

  return (
    <div className='mt-8'>
      <div className='flex justify-between items-center mb-6'>
        <h1 className='text-2xl font-bold'>חוזים</h1>
        <Btn lbl='יצירת חוזה' icon='plus' popoverTarget='contract-popover' />
      </div>

      <div id='contract-popover' popover='auto' className='pop'>
        <ContractForm contracts={contracts} users={users} />
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
        {contracts.map((contract) => (
          <div key={contract.id} className='card'>
            <h3 className='title'>{contract.name}</h3>
            <p className='text-gray-600'>
              סוג החוזה: <span className='font-bold'>{contract.type}</span>
            </p>

            <Btn href={`/settings/edit_contracts/${contract.id}`} lbl='פרטים' icon='file-contract' className='my-4' />

            <div className='flex justify-between'>
              <Btn lbl='שכפול' icon='copy' variant='outline' popoverTarget={`edit-contract-popover-${contract.id}`} />
              <DeleteContractButton contract={contract} />
            </div>

            <div id={`edit-contract-popover-${contract.id}`} className='max-w-3xl pop' popover='auto'>
              <ContractForm contracts={contracts} isDuplicate contract={contract} users={users} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
