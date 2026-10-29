'use client'
import AddAuthUsersComp from '@/components/agntsAndGrps/AddAuthUsers'
import EditFilters from '@/components/filter/EditSavedFilters'
import UserDetailsForm from '@/components/settings/userDetails/UserDetailsForm'
import AccordionItem from '@/lib/AccordionItem'
import UploadClientData from '@/components/settings/UploadClientData'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import ExtUsers from '../extUsers'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

const Badge = ({ label, variant }: { label: string; variant: 'start' | 'primary' | 'muted' }) => {
  const styles = {
    start: 'bg-green-100 text-green-700',
    primary: 'bg-blue-100 text-blue-700',
    muted: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[variant]}`}>{label}</span>
  )
}

export default function SelfEdit({ curUser, users, extUsers, allUsers, user, gavePerm }) {
  const t = useT()
  const region = useRegionAttrs()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const bodyClass = 'p-6'
  return (
    <div {...region}>
      <h1 className='title'>{t('settings.account.title.selfEdit')}</h1>
      <p className='mt-2 mb-8 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        {t('settings.account.selfEdit.intro')}
      </p>
      <div className='accordion mb-6 max-w-2xl'>
        <AccordionItem
          icon='user'
          bodyClass={bodyClass}
          title={t('settings.account.selfEdit.personal.title')}
          badge={<Badge label={t('settings.account.selfEdit.badge.start')} variant='start' />}
        >
          <p className='text-gray-500 text-sm mb-4'>{t('settings.account.selfEdit.personal.intro')}</p>
          <UserDetailsForm user={curUser} />
        </AccordionItem>
        <AccordionItem
          icon='shield-check'
          bodyClass={bodyClass}
          title={t('settings.account.selfEdit.access.title')}
          badge={<Badge label={t('settings.account.selfEdit.badge.advanced')} variant='muted' />}
        >
          <p className='text-gray-500 text-sm mb-4'>{t('settings.account.selfEdit.access.intro')}</p>
          <AddAuthUsersComp users={users} gavePerm={gavePerm} user={user} />
        </AccordionItem>
        {/*
          Titled for what this actually creates. It read "אנשי צוות" over a form
          that takes only a name, so two ADMINs in two days added someone here
          expecting to give them access and got a label that cannot log in.
          Across all of production this path was used twice and the real
          invitation zero times. The EXT model is unchanged and correct — these
          are assignment names for לידים. Only the wording, and a route to the
          real invitation, change.
        */}
        <AccordionItem
          icon='user-alien'
          bodyClass={'p-6'}
          title={t('settings.account.selfEdit.reps.title')}
          open={tab === 'ext_users'}
          badge={<Badge label={t('settings.account.selfEdit.badge.optional')} variant='muted' />}
        >
          <p className='text-gray-500 text-sm mb-2'>
            {t('settings.account.selfEdit.reps.intro')}
          </p>
          {/*
            The destination is ADMIN-only — the (admin_settings) layout rejects
            every other role — so linking anyone else would lead straight to a
            permission wall. Non-admins get the same fact without the dead end.
          */}
          {user?.role === 'ADMIN' ? (
            <p className='text-sm mb-4'>
              <Link href='/settings/edit_users' className='text-sm font-medium text-primary hover:underline'>
                {t('settings.account.selfEdit.reps.invite')}
              </Link>
            </p>
          ) : (
            <p className='text-gray-500 text-sm mb-4'>
              {t('settings.account.selfEdit.reps.askAdmin')}
            </p>
          )}
          <ExtUsers extUsers={extUsers} users={allUsers} />
        </AccordionItem>
        <AccordionItem
          icon='file-excel'
          bodyClass={bodyClass}
          title={t('settings.account.selfEdit.upload.title')}
          open={tab === 'upload'}
          badge={<Badge label={t('settings.account.selfEdit.badge.primary')} variant='primary' />}
        >
          <p className='text-gray-500 text-sm mb-4'>{t('settings.account.selfEdit.upload.intro')}</p>
          <UploadClientData />
        </AccordionItem>
        <AccordionItem
          icon='filter'
          bodyClass={bodyClass}
          title={t('settings.account.selfEdit.filters.title')}
          open={tab === 'filters'}
          badge={<Badge label={t('settings.account.selfEdit.badge.advanced')} variant='muted' />}
        >
          <p className='text-gray-500 text-sm mb-4'>{t('settings.account.selfEdit.filters.intro')}</p>
          <p className='text-gray-400 text-xs mb-4'>{t('settings.account.selfEdit.filters.hint')}</p>
          <EditFilters filters={user.savedFilters} user={user} />
        </AccordionItem>
      </div>
    </div>
  )
}
