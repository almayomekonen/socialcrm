'use client'
import React from 'react'
import { Input, Select } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import FileUploader from '@/components/files/FileUploader'
import { updateUserInfoData } from '@/actions/usersNteams'
import { agentLicenseTypeOptions } from './useOpts'

export default function UserAgntLicenseForm({ user }) {
  async function onSubmit(e) {
    const data = getFormData2(e)
    data.agentLicenseFiles = JSON.parse(data.agentLicenseFiles)
    api(updateUserInfoData, [data, user.id])
  }

  return (
    <form onSubmit={onSubmit}>
      <div className='grid grid-cols-1 gap-4'>
        <Input name='agentLicenseNum' lbl='מספר רישיון' defaultValue={user.agentLicenseNum} />
        <Select name='agentLicenseType' lbl='סוג רישיון' options={agentLicenseTypeOptions} defaultValue={user.agentLicenseType} />
        <Input name='agentLicenseName' lbl='שם בעל הרשיון' defaultValue={user.agentLicenseName} />

        <FileUploader
          tooltipClass='h-20'
          initialFiles={user.agentLicenseFiles}
          title='קבצי רישיון'
          name='agentLicenseFiles'
        />
      </div>
      <Btn lbl='שמירה' className='w-full mt-4' />
    </form>
  )
}
