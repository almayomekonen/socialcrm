'use client'
import { Btn } from '@/lib/btns/Btn'
import AddPromoForm from './AddPromoForm'
import DeletePromoBtn from './DeletePromoBtn'
import { useState } from 'react'
import ModalPop from '../../lib/modals/ModalPop'

export default function PromoCards({ promos, teams, users }) {
  const [curPromo, setcurPromo] = useState(false)

  return (
    <div>
      <Btn lbl='מבצע חדש' icon='plus' className='mb-4 w-fit' onClick={() => setcurPromo(true)} />

      <section className='flex '>
        {promos.map((promo) => (
          <div className='w-[340px] bg-white p-6 rounded-md shadow-1 mb-4 min-h-[380px]' key={promo.id}>
            <img src={promo?.img?.url || '/media/placeholder.webp'} alt='' className='h-40 w-full rounded-md' />
            <div className='grid grid-cols-[auto,1fr] gap-2 items-center my-3'>
              <h1 className='text-lg font-semibold'>{promo.title}</h1>
              <span className='flex gap-2 justify-self-end flex-nowrap'>
                <Btn variant='outline' size='icon' onClick={() => setcurPromo(promo)} icon='pen' />
                <DeletePromoBtn promoId={promo.id} />
              </span>
            </div>
            <p className='line-clamp-3'>{promo.desc}</p>
          </div>
        ))}
      </section>

      <ModalPop open={!!curPromo} className='w-[800px]' pos='middle' onClose={() => setcurPromo(false)}>
        <AddPromoForm teams={teams} users={users} promo={curPromo} setcurPromo={setcurPromo} />
      </ModalPop>
    </div>
  )
}
