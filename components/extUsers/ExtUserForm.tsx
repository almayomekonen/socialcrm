import { getFormData2 } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { api } from '@/lib/funcs'
import { upsertExtUser } from '@/actions/usersNteams'

export default function ExtUserForm({ user, setCurUser }) {
  async function onSave(e) {
    const data = getFormData2(e)

    const res = await api(upsertExtUser, [data, user?.id])
    if (res.err && res.msg.includes('duplicate')) return alert('שם זה כבר קיים במערכת')

    e.target.reset()
    setCurUser(null)
  }

  return (
    <form className='max-w-72 ' key={user?.id} onSubmit={onSave}>
      {/* {user?.id && <Title lbl={`${user?.id ? 'עריכת סוכן חיצוני' : ''}`} flip iconClassName='size-5' className='mb-4' />} */}
      <Input lbl='שם פרטי' name='firstName' defaultValue={user?.firstName} className=' mb-1' />
      <Input lbl='שם משפחה' name='lastName' defaultValue={user?.lastName} required={false} />
      <div className='grid grid-cols-2 mt-4 gap-4'>
        {user && <Btn variant='outline' lbl='ביטול' icon='xmark' onClick={() => setCurUser(null)} />}
        <Btn
          lbl={user?.id ? 'שמור עריכה' : 'הוסף נציג'}
          icon={user?.id ? 'floppy-disk-pen' : 'floppy-disk'}
          className={user?.id ? '' : 'col-span-2'}
        />
      </div>
    </form>
  )
}
