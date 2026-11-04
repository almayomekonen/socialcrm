import PoweredBySocialCRM from '@/lib/navs/PoweredBySocialCRM'
import Icon from '@/lib/Icon'
import { buildPageMetadata } from '@/lib/seo/metadata'

export const metadata = buildPageMetadata({
  path: '/thank-you',
  title: 'תודה | SocialCRM',
  description: 'הפעולה בוצעה בהצלחה.',
  noindex: true,
})

/**
 * Fixed copy. This used to print `?title=` and `?description=` straight into the
 * <h1> and the body, so anyone could send a link to our domain that said
 * whatever they wanted. Nothing in the product links here with parameters.
 */
export default function ThankYouPage() {
  return (
    <div className='h-screen flex flex-col'>
      <div className='flex-1 flex items-center justify-center px-4'>
        <div className='max-w-2xl w-full bg-white shadow-lg rounded p-8  text-center'>
          <div className='size-20 mb-6  bg-green-100 rounded-full flex justify-center mx-auto'>
            <Icon name='check' className='size-8' />
          </div>

          <h1 className='text-3xl md:text-4xl font-bold  mb-4'>תודה!</h1>

          <p className='text-lg mb-8'>הפעולה בוצעה בהצלחה</p>
        </div>
      </div>
      <PoweredBySocialCRM />
    </div>
  )
}
