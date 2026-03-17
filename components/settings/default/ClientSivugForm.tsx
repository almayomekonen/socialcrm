'use client'
import React from 'react'
import { Btn } from '@/lib/btns/Btn'
import Subtitle from '@/lib/Subtitle'
import { updateDefaultSettings } from '@/actions/usersNteams'
import { api } from '@/lib/funcs'
import { getFormData2 } from '@/lib/form/funcs'
import { InputSides } from '@/lib/form'

export default function ClientSivugForm({ data, userId }) {
  async function onSubmit(e) {
    const data = getFormData2(e)
    api(updateDefaultSettings, [data, userId])
  }

  return (
    <form onSubmit={onSubmit}>
      <div className='grid gap-4'>
        <Subtitle lbl='ארד' />
        <InputSides lblRight='קטן מ:' lblLeft='₪' name='bronze' defaultValue={data.bronze} />

        <Subtitle lbl='כסף' />
        <p>בן ארד לזהב</p>

        <Subtitle lbl='זהב' />
        <InputSides lblRight='מעל:' lblLeft='₪' name='gold' defaultValue={data.gold} />
      </div>
      <Btn lbl='שמירה' className='w-full mt-4' />
    </form>
  )
}
