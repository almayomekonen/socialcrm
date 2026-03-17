import PoweredByAllin from '@/lib/navs/PoweredByAllin'
import Icon from '@/lib/Icon'

export default async function ThankYouPage({ searchParams }) {
  const params = await searchParams
  const title = params.title || 'תודה!'
  const description = params.description || 'הפעולה בוצעה בהצלחה'

  return (
    <div className='h-screen flex flex-col'>
      <div className='flex-1 flex items-center justify-center px-4'>
        <div className='max-w-2xl w-full bg-white shadow-lg rounded p-8  text-center'>
          <div className='size-20 mb-6  bg-green-100 rounded-full flex justify-center mx-auto'>
            <Icon name='check' className='size-8' />
          </div>

          <h1 className='text-3xl md:text-4xl font-bold  mb-4'>{title}</h1>

          <p className='text-lg mb-8'>{description}</p>
        </div>
      </div>
      <PoweredByAllin />
    </div>
  )
}
