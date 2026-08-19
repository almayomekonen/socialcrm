import Icon from '@/lib/Icon'

export default function ReadyMessagesEmptyMobile({ onCreate }: { onCreate: () => void }) {
  return (
    <div className='rounded-xl border border-gray-200 bg-white p-5'>
      <p className='text-base font-semibold text-ink'>אין עדיין הודעות מוכנות</p>
      <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
        הודעה מוכנה מאפשרת לפנות לליד גם אחרי שהשיחה נרגעה — תזכורת, מבצע או עדכון.
      </p>
      <button
        type='button'
        onClick={onCreate}
        className='press mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <Icon name='plus' type='sol' className='size-4 bg-white' />
        צרו הודעה מוכנה
      </button>
    </div>
  )
}
