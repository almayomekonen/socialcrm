import { getUser } from '@/db/auth'
import { getPerms } from '@/db/filter'
import { getPromos, getPromosByUserId } from '@/db/promos'
import { isAdmin, Roles } from '@/types/roles'
import Link from 'next/link'
import AccordionItem from '@/lib/AccordionItem'

export default async function PromotionPage() {
  const user = await getUser()
  const { gotPermIds } = await getPerms(user)
  let promos = isAdmin(user.role) ? await getPromos() : await getPromosByUserId(user.id, gotPermIds)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const pastPromos = promos.filter((promo) => promo.end < today)
  promos = promos.filter((promo) => promo.end >= today)

  if (!promos.length)
    return (
      <div className='my-8'>
        <h1 className='title mb-6'>הקמפיינים</h1>
        <div className='text-center py-16 border rounded-lg bg-white max-w-md mx-auto'>
          <p className='text-4xl mb-4'>🏆</p>
          <p className='text-xl font-semibold mb-2'>אין עדיין קמפיינים</p>
          <p className='text-gray-500 text-sm leading-relaxed'>
            קמפיינים הם תחרויות מכירה פנימיות בין הנציגים.
            <br />
            המנהל יוצר קמפיין עם יעדים ופרסים — ואתה רואה כאן את ההתקדמות שלך.
          </p>
        </div>
      </div>
    )

  return (
    <div className=''>
      <h1 className='title mb-4'>הקמפיינים</h1>

      <PromoBox promos={promos} />
      <div className='accordion border rounded-lg my-6  bg-white'>
        <AccordionItem title='קמפיינים שחלפו'>
          <PromoBox promos={pastPromos} />
        </AccordionItem>
      </div>
    </div>
  )
}

function PromoBox({ promos }) {
  return (
    <section className='flex '>
      {promos.map((promo) => {
        return (
          <Link href={`/promotion/${promo.id}`} key={promo.id}>
            <div className='w-80 bg-white p-6 rounded-md shadow-1 mb-4 min-h-[360px]'>
              <img src={promo.img?.url || '/media/placeholder.webp'} alt='' className='h-40 w-full rounded-md' />
              <h1 className='text-xl font-semibold my-3'>{promo.title}</h1>
              <p className='line-clamp-3'>{promo.desc}</p>
            </div>
          </Link>
        )
      })}
    </section>
  )
}
