import ChargesTable from '@/components/settings/payment/ChargesTable'
import Packages from '@/components/settings/payment/Packages'
import PkgDetails from '@/components/settings/payment/PkgDetails'
import { getCurPkg } from '@/db/agencies'
import AccordionItem from '@/lib/AccordionItem'

export default async function page() {
  const bodyClass = 'p-6'
  const curPkg = await getCurPkg()
  const charges = [
    {
      name: 'חיוב חבילת ניצן',
      invoiceNum: '1234567890',
      pkg: 'ניצן',
      status: 'שולם',
      amount: 100,
      date: '2025-01-01',
    },
    {
      name: 'חיוב חבילת ניצן',
      invoiceNum: '1234567890',
      pkg: 'ניצן',
      status: 'שולם',
      amount: 100,
      date: '2025-02-01',
    },

    {
      name: 'חיוב חבילת ניצן',
      invoiceNum: '1234567890',
      pkg: 'ניצן',
      status: 'שולם',
      amount: 100,
      date: '2025-02-01',
    },
  ]
  return (
    <div>
      <h1 className='title'>פרטי חבילה ותשלום</h1>
      <h1 className='text-xl font-bold mt-12'>פרטי חבילה</h1>
      <div className='accordion my-6 max-w-3xl'>
        <AccordionItem bodyClass={bodyClass} title='פרטי חבילה'>
          <PkgDetails curPkg={curPkg} />
        </AccordionItem>
      </div>
      <h1 className='text-xl font-bold mt-12'>פרטי תשלום</h1>
      <div className='accordion my-6 max-w-3xl'>
        <AccordionItem bodyClass={bodyClass} title='עדכון אמצעי תשלום'>
          <div>
            <h1 className='font-bold'>אמצעי תשלום</h1>
            <p className='font-semibold'>526526526526</p>
            <p>החיוב הבא יתבצע ב-10/09/2025</p>
          </div>
        </AccordionItem>
        <AccordionItem bodyClass={bodyClass} title='צפייה בחיובים'>
          <ChargesTable data={charges} />
        </AccordionItem>
      </div>
      <h1 className='text-xl font-bold mt-12'>שינוי חבילה</h1>
      <Packages curPkg={curPkg} />
    </div>
  )
}
