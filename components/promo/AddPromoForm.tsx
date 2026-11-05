'use client'

import { Checkbox, Input } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import { useState } from 'react'
import { upsertPromo } from '../../actions/promos'
import SelectPrdctOpts from '../cmsnRules/SelectPrdctOpts'
import { getPromoFormData } from './funcs'
import { api } from '@/lib/funcs'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import FileUploader from '../files/FileUploader'
import Fieldset from '@/lib/Fieldset'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import SelectStartEndDate from '../filter/SelectStartEndDate'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

export default function AddPromoForm({ teams, users, promo, setcurPromo }) {
  const t = useT()
  const goalKeys = Object.keys(promo?.goals?.target || {})
  const firstGoalKey = goalKeys[0]
  const condGoalsKeys = goalKeys.splice(1) as any[]

  const [conds, setConds] = useState(
    condGoalsKeys.map(() => {
      return { id: Math.random() }
    }) || []
  )

  const [goalLength, setGoalLength] = useState(promo?.goals?.target?.[firstGoalKey]?.length || 1)

  const [isPromoGrp, setIsPromoGrp] = useState(promo.isPromoGrp)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function onSubmit(e) {
    const data = getPromoFormData(e)
    if (!data?.grpIds?.length && !data?.userIds?.length) return setErrMsg(t('admin.promos.form.noTargets'))

    data.files = JSON.parse(data.files)
    data.img = JSON.parse(data.img)

    await api(upsertPromo, [data, promo?.id])
    setcurPromo(false)
  }

  return (
    <div>
      <h2 className='title mb-6'>{promo?.id ? t('admin.promos.edit') : t('admin.promos.form.add')}</h2>
      <form onSubmit={onSubmit} className='grid grid-cols-2 items-end gap-6'>
        <Input name='title' lbl={t('admin.promos.form.name')} defaultValue={promo?.title} />
        <SelectStartEndDate data={promo} startName='start' endName='end' />

        <span className='col-span-2 flex'>
          <Checkbox
            lbl={t('admin.promos.form.forManager')}
            defaultChecked={promo?.isPromoGrp}
            onChange={() => setIsPromoGrp(!isPromoGrp)}
            name='isPromoGrp'
          />
        </span>

        <MultiSelectSearch options={teams} name='grpIds' placeholder={t('admin.promos.form.searchTeams')} lbl={t('admin.promos.form.teams')} selected={promo?.grpIds} />
        {!isPromoGrp && (
          <MultiSelectSearch options={users} name='userIds' placeholder={t('admin.promos.form.searchReps')} lbl={t('admin.promos.form.reps')} selected={promo?.userIds} />
        )}

        <span className='col-span-2'>
          <Input as='textarea' name='desc' lbl={t('admin.promos.form.desc')} defaultValue={promo?.desc} />
        </span>

        {/* ענפים */}
        <span className='col-span-2 flex'>
          <SelectBranch index='0' goalLength={goalLength} setGoalLength={setGoalLength} promo={promo} />
        </span>
        <Btn
          lbl={t('admin.promos.form.addConds')}
          icon='plus'
          variant='soft'
          onClick={() => setConds([...conds, { id: Math.random() }])}
          type='button'
        />
        <span className='col-span-2 grid gap-4'>
          {conds.map((cond, i) => (
            <Fieldset legend={t('admin.promos.form.cond', { n: String(i + 1) })} key={cond.id} className='flex gap-4 items-end border rounded-md p-4'>
              <SelectCondBranch index={i + 1} goalLength={goalLength} condGoalsKey={condGoalsKeys[i]} promo={promo} />
              <Btn
                icon='trash'
                type='button'
                variant='destructive'
                size='icon'
                aria-label={t('admin.promos.form.removeCond', { n: String(i + 1) })}
                onClick={() => {
                  setConds(conds.filter((_, index) => index !== i))
                }}
              />
            </Fieldset>
          ))}
        </span>

        <FileUploader
          name='img'
          initialFiles={promo?.img}
          type='image'
          single={true}
          title={t('admin.promos.form.uploadImg')}
          translated
        />
        <FileUploader name='files' initialFiles={promo?.files} title={t('admin.promos.form.uploadRules')} translated />

        <SubmitButton lbl={t('admin.promos.form.save')} icon='floppy-disk' className='col-span-2 mt-4' />
      </form>
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
        translated
      />
    </div>
  )
}

function SelectBranch({ goalLength, setGoalLength, promo, index }) {
  const tr = useT()
  const t = Array(goalLength).fill(0)
  const curGoal = Object.keys(promo?.goals?.target || {})[0]

  return (
    <div>
      <div className='flex items-end gap-2 '>
        <SelectPrdctOpts key={Math.random()} prdct={promo?.goals?.conditions?.[index] || {}} index={index} />

        {/* Icon-only, named in every language (final UI audit, owner-approved Hebrew a11y change). */}
        <Btn
          onClick={() => setGoalLength(goalLength + 1)}
          className='px-3 '
          icon='plus'
          variant='soft'
          type='button'
          aria-label={tr('admin.promos.form.addGoal')}
        />
        {goalLength !== 1 && (
          <Btn
            onClick={() => {
              setGoalLength(goalLength - 1)
            }}
            icon='minus'
            className='px-3'
            variant='soft'
            type='button'
            aria-label={tr('admin.promos.form.removeGoal')}
          />
        )}
      </div>

      <div className='grid grid-cols-2 gap-4 mt-4'>
        {t.map((_, i) => (
          <Fieldset legend={tr('admin.promos.form.goalPrize', { n: String(i + 1) })} key={i} className='flex flex-nowrap'>
            <Input name='targets[]' lbl={tr('admin.promos.form.goal', { n: String(i + 1) })} type='number' defaultValue={promo?.goals?.target?.[curGoal]?.[i]} />
            <Input name='prize[]' lbl={tr('admin.promos.form.prize', { n: String(i + 1) })} type='text' defaultValue={promo?.goals?.prize[i]} />
          </Fieldset>
        ))}
      </div>
    </div>
  )
}

function SelectCondBranch({ goalLength, condGoalsKey, promo, index }) {
  const tr = useT()
  const t = Array(goalLength).fill(0)

  return (
    <>
      <div className='flex items-end'>
        <SelectPrdctOpts key={Math.random()} prdct={promo?.goals?.conditions?.[index] || {}} index={index} />
      </div>

      <div className='flex'>
        {t.map((_, i) => (
          <Input
            name='targets[]'
            lbl={tr('admin.promos.form.goal', { n: String(i + 1) })}
            type='number'
            key={i}
            defaultValue={promo?.goals?.target?.[condGoalsKey]?.[i]}
          />
        ))}
      </div>
    </>
  )
}

function extractGroups(data) {
  const result = []
  let i = 0

  while (`userIds${i}` in data || `grpIds${i}` in data || `grpName${i}` in data) {
    result.push({
      userIds: data[`userIds${i}`],
      grpIds: data[`grpIds${i}`],
      grpName: data[`grpName${i}`],
    })

    delete data[`userIds${i}`]
    delete data[`grpIds${i}`]
    delete data[`grpName${i}`]

    i++
  }

  return result
}
