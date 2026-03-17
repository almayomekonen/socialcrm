'use client'

import Title from '@/lib/Title'
import { Roles, rolesOpt } from '@/types/roles'
import { deleteUser, fetchIsUserHaveSales, upsertUser, upsertUserNPerms } from '../../actions/usersNteams'
import { useEffect, useState } from 'react'
import { api } from '@/lib/funcs'
import InputCheckbox from '@/lib/checkbox/InputCheckbox'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import { getFormData2 } from '@/lib/form/funcs'
import { Input, Select } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'

export default function EditUser({ user, agnts, teams }) {
  const [role, setRole] = useState<Roles>(user?.role)

  useEffect(() => {
    setRole(user?.role)
  }, [user?.role])

  async function onSubmit(e) {
    const fd = getFormData2(e) as any
    console.log('fd:', fd)

    // IF FORM DATA ROLE IS OFFICE
    if (fd.role === Roles.OFFICE) {
      if (user?.id && user.role !== Roles.OFFICE) {
        const userHaveSales = await fetchIsUserHaveSales(user.id)
        if (userHaveSales) {
          return alert(`
            לא ניתן להחליף את הנציג למתפעל, כיוון שיש לנציג מכירות. העבר את המכירות לנציג אחר ונסה שוב.
         `)
        }
      }

      fd.goals = null
      api(upsertUserNPerms, [fd, user?.id])
      return
    }

    // IF FORM DATA ROLE ISN'T OFFICE
    if (user?.role === Roles.OFFICE && fd.role !== Roles.OFFICE) fd.gotPermIds = []

    fd.suspended = Boolean(fd.suspended)

    delete fd.gotPermIds
    api(upsertUser, [fd, user?.id])
  }

  async function onDelete() {
    if (!confirm(`בטוח למחוק את ${user?.name}?`)) return
    const userHaveSales = await fetchIsUserHaveSales(user?.id)
    if (userHaveSales) {
      return alert(`
      המשתמש ${user.name} לא נמחק, מכיוון שיש מכירות על שמו.
      מחק את המכירות
      או העבר אותם לנציג אחר
      ונסה שוב`)
    }

    await api(deleteUser, user?.id, null, 'לא ניתן למחוק את הנציג כי מקושרים אליו לקוחות')
  }

  const isExtOrOffice = [Roles.OFFICE, Roles.EXT].includes(role)

  return (
    <div popover='auto' id='editUserForm' className='modal_pop'>
      <div className='flex justify-between'>
        <Title lbl={`${user?.name || 'הוספת משתמש'}`} icon='user' />
        <div className='flex gap-2 flex-nowrap'>
          {user?.id && role !== 'OFFICE' && (
            <Btn variant='outline' size='icon' title='העברת מכירות לנציג אחר' icon='right-left' popoverTarget='transferSales' />
          )}
          {user?.id && <Btn variant='outline' size='icon' icon='trash' onClick={onDelete} />}
        </div>
      </div>
      <form key={user?.id} onSubmit={onSubmit} className='max-w-xl'>
        <h2 className='my-4 text-lg border-b text-gray-600 w-full'>פרטים אישיים</h2>
        <div className='grid grid-cols-3 gap-4 items-end mobile:grid-cols-2 mobile:gap-2'>
          <Input lbl='שם פרטי' name='firstName' defaultValue={user?.firstName} />
          <Input lbl='שם משפחה' name='lastName' defaultValue={user?.lastName} />
          <Input
            lbl='מייל'
            name='email'
            defaultValue={user?.email}
            type='email'
            title='הזן כתובת דואר אלקטרוני תקינה (לדוגמה, user@example.com)'
          />

          <Input lbl='מספר טלפון' name='phone' required={false} defaultValue={user?.phone} />
          <Select
            lbl='תפקיד'
            name='role'
            options={rolesOpt}
            defaultValue={user?.role}
            onChange={(e) => setRole(e.target.value as Roles)}
          />
          {role !== Roles.EXT && <InputCheckbox lbl='חשבון מושעה' name='suspended' defaultChecked={user?.suspended} />}
        </div>

        {!isExtOrOffice && (
          <div className='mb-8'>
            <h2 className='my-4 text-lg border-b text-gray-600 w-full'>יעדים</h2>

            <div className='grid grid-cols-3 gap-4'>
              <Input lbl='שירותים' name='goals.סיכונים' defaultValue={user?.goals?.סיכונים} type='number' required={false} />
              <Input
                lbl='מנויים-שוטף'
                name='goals.פנסיוני-שוטף'
                defaultValue={user?.goals?.['פנסיוני-שוטף']}
                type='number'
                required={false}
              />
              <Input
                lbl='מנויים-ניוד'
                name='goals.פנסיוני-ניוד'
                defaultValue={user?.goals?.['פנסיוני-ניוד']}
                type='number'
                required={false}
              />

              {/* חד"פ & ניוד */}
              <Input lbl='חבילות' name='goals.פיננסים' defaultValue={user?.goals?.פיננסים} type='number' required={false} />
              <Input
                lbl='חבילות-שוטף'
                name='goals.פיננסים-שוטף'
                defaultValue={user?.goals?.['פיננסים-שוטף']}
                type='number'
                required={false}
              />
              <Input lbl='מוצרים' name='goals.אלמנטרי' defaultValue={user?.goals?.אלמנטרי} type='number' required={false} />
              <Input lbl='יעד עמלה' name='goals.משוקלל' defaultValue={user?.goals?.משוקלל} type='number' required={false} />
            </div>
          </div>
        )}

        {role == 'OFFICE' && (
          <div className='my-4 space-y-4'>
            <h2 className='text-lg border-b text-gray-600 w-full'>הרשאות</h2>
            <MultiSelectSearch options={agnts} selected={user?.gotPerm.map((item) => item.id)} name='gotPermIds' lbl='נציגים' />
          </div>
        )}

        <Btn lbl='שמור פרטים' icon='floppy-disk' className='w-full my-8' />
      </form>
    </div>
  )
}

// OLD CODE
// const goals = {
//   סיכונים: fd.סיכונים,
//   פיננסים: fd.פיננסים,
//   פנסיוני: fd.פנסיוני,
// }
// // continue from here
// const rate = {
//   סיכונים: 1,
//   פיננסים: 0.01,
//   פנסיוני: 0.1,
// }

// let totalCmsn = 0
// for (const key in goals) {
//   if (goals[key]) totalCmsn += goals[key] * rate[key]
// }

// fd.goals = { ...goals, משוקלל: totalCmsn }
// omit(fd, ['סיכונים', 'פיננסים', 'פנסיוני', 'פנסיוני_ניוד', 'פיננסים_שוטף', 'אלמנטרי'])
