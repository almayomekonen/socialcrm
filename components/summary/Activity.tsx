export default function Activity({ clientId }: { clientId: string }) {
  return (
    <div className='xl:p-8'>
      <h1 className='text-2xl font-bold my-4'>פעילות</h1>
      <div className='text-center py-12 text-gray-400'>
        <p className='text-base'>עדיין אין פעילות ללקוח זה</p>
      </div>
    </div>
  )
}
