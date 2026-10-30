import { Btn } from '@/lib/btns/Btn'
import { getFormData2 } from '@/lib/form/funcs'
import { useState } from 'react'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import { useT } from '@/lib/i18n/I18nProvider'

export default function SelectFilterUserPromo({ data, setState }) {
  console.log('data:', data)
  const [selectedUsers, setSelectedUsers] = useState([])
  const t = useT()

  async function onSubmit(e) {
    const { users } = getFormData2(e) as { users: string[] }
    if (!users || users?.length < 1) {
      setState(data)
      setSelectedUsers([])
      return null
    }

    console.log('users:', users)
    const filteredData = data.filter((user) => users.includes(user.נציג))
    setSelectedUsers(users)
    setState(filteredData)
  }

  function clearFilters() {
    setState(data)
    setSelectedUsers([])
  }

  return (
    <form onSubmit={onSubmit} className='flex gap-0 items-end'>
      <MultiSelectSearch
        options={data?.map((elem) => elem.נציג)}
        name='users'
        returnShow='userNames'
        selected={selectedUsers}
        className='rounded-e-none'
        placeholder={t('performance.promotion.filterReps')}
      />
      {selectedUsers.length > 0 && (
        <Btn
          title={t('performance.promotion.resetFilter')}
          variant='outline'
          size='icon'
          className='rounded-none border-s-0 shadow-none'
          icon='xmark'
          onClick={clearFilters}
        />
      )}
      <Btn title={t('performance.promotion.filterRepsButton')} variant='outline' size='icon' className='rounded-s-none border-s-0 shadow-none' icon='filter' />
    </form>
  )
}
