import AddAgencyForm from '@/components/agencies/AddAgencyForm'
import Icon from '@/lib/Icon'
import Link from 'next/link'

export default function page() {
  return (
    <div className='fixed top-0 right-0'>
      <div className='grid lg:grid-cols-2  w-screen bg-white place-items-center'>
        <div className='grid place-items-center py-24 lg:py-0 gap-8'>
          <Link href='/auth' className='flex font-semibold underline'>
            <Icon name='arrow-right' className='size-3' />
            חזור אחורה
          </Link>
          <h1 className='text-5xl font-bold'>מתחילים כאן</h1>
          <AddAgencyForm />
        </div>
        <img src='/media/auth.jpg' alt='' className='w-full h-screen' />
      </div>
    </div>
  )
}
