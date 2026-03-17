'use client'

import { copyToClipboardToast } from '@/lib/funcs'
import { formatDateAge } from '@/lib/dates'
import { usePathname, useRouter } from 'next/navigation'
import { Select } from '@/lib/form'
import Icon from '@/lib/Icon'
import { FormatRank } from '../clients/funcs'

export default function ClientHeader({ client, user, handlerName, family, clientId }) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className='bg-[#e8ecf4] px-12 full-bleed  '>
      <div className='overflow-x-auto '>
        <div className='flex gap-8 py-2.5 justify-between font-medium min-w-max'>
          <div className='flex items-center gap-4 '>
            <FormatRank rank={client.rank} />
            <p className='font-bold  w-28'>{client.name}</p>
            {family.length > 0 && (
              <Select
                className='bg-softy h-8 w-40 rounded-full border-solid font-semibold'
                options={family}
                defaultValue={clientId}
                onChange={(e) => {
                  if (e.target.value) {
                    router.push(`${pathname.replace(/\/clients\/[^\/]+/, `/clients/${e.target.value}`)}` as any)
                  }
                }}
              />
            )}
          </div>

          <p>{formatDateAge(client.birthDate)}</p>
          <p>{client.gender}</p>
          <p>{client.familyStatus}</p>

          {client.email && (
            <div
              onClick={() => copyToClipboardToast(client.email)}
              className='bg-softy cursor-pointer rounded-xl px-4 flex items-center gap-2'
            >
              <Icon name='copy' className='size-4 bg-solid' />
              {client.email}
            </div>
          )}

          <p>{client.phone}</p>
          {handlerName && (
            <div className='flex items-end gap-2'>
              <h2>אחראי לקוח:</h2>
              <p className='font-bold'>{handlerName}</p>
            </div>
          )}

          {/* <Icon name='ellipsis-vertical' className='size-8' /> */}
        </div>
      </div>
    </div>
  )
}
