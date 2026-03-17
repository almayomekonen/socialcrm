'use client'

import { updateDefaultSettings } from '@/actions/usersNteams'
import { api } from '@/lib/funcs'
import Subtitle from '@/lib/Subtitle'
import { CheckboxBool } from '@/lib/checkbox/CheckboxBool'
import { Seperator } from '@/lib/Seperator'
import { Btn } from '@/lib/btns/Btn'
import { getFormData2 } from '@/lib/form/funcs'
import { InputSides } from '@/lib/form'

export default function AiSettingsForm({ data, userId }) {
  async function onSubmit(e) {
    const data = getFormData2(e)

    api(updateDefaultSettings, [data, userId])
  }

  return (
    <form className='p-4 bg-white rounded-lg border my-6 grid grid-cols-1 gap-4 max-w-3xl' onSubmit={onSubmit}>
      <Subtitle lbl='שינוי בהפקדה חודשית' />
      <InputSides lblRight='גדול מ' lblLeft='%' name='achuzHafkadaPensia' defaultValue={data.achuzHafkadaPensia} />

      <Seperator />
      <h1 className='text-xl font-bold mb-6 '>אחוזי ניהול חריגים</h1>
      <div className='grid grid-cols-2 '>
        <div className='grid gap-4'>
          <Subtitle lbl='קטגוריה א' />
          <InputSides
            lblRight='צבירה >='
            lblLeft='%'
            name='achuzDmeiNihulKupatGemelTzvira'
            defaultValue={data.achuzDmeiNihulKupatGemelTzvira}
          />
          <InputSides
            lblRight='הפקדה >='
            lblLeft='%'
            name='achuzDmeiNihulKupatGemelHafkada'
            defaultValue={data.achuzDmeiNihulKupatGemelHafkada}
          />
        </div>
        <div className='grid gap-4'>
          <Subtitle lbl='קטגוריה ב' />
          <InputSides
            lblRight='צבירה >='
            lblLeft='%'
            name='achuzDmeiNihulKerenHishtalmutTzvira'
            defaultValue={data.achuzDmeiNihulKerenHishtalmutTzvira}
          />
          <InputSides
            lblRight='הפקדה >='
            lblLeft='%'
            name='achuzDmeiNihulKerenHishtalmutHafkada'
            defaultValue={data.achuzDmeiNihulKerenHishtalmutHafkada}
          />
        </div>
      </div>

      <div className='grid grid-cols-2 mt-4 '>
        <div className='grid gap-4'>
          <Subtitle lbl='קטגוריה ג' />
          <InputSides
            lblRight='צבירה >='
            lblLeft='%'
            name='achuzDmeiNihulPensiaTzvira'
            defaultValue={data.achuzDmeiNihulPensiaTzvira}
          />
          <InputSides
            lblRight='הפקדה >='
            lblLeft='%'
            name='achuzDmeiNihulPensiaHafkada'
            defaultValue={data.achuzDmeiNihulPensiaHafkada}
          />
        </div>
        <div className='grid gap-4'>
          <Subtitle lbl='קטגוריה ד' />
          <InputSides
            lblRight='צבירה >='
            lblLeft='%'
            name='achuzDmeiNihulMenahalimTzvira'
            defaultValue={data.achuzDmeiNihulMenahalimTzvira}
          />
        </div>
      </div>

      <Seperator />

      <p>לא בוצעה פגישת שירות תקופתית מיצירת המשימה האחרונה</p>
      <InputSides
        lblRight='מעל >='
        lblLeft='חודשים'
        name='monthsLoButzaPgishatSherutTkufatit'
        defaultValue={data.monthsLoButzaPgishatSherutTkufatit}
      />

      <Seperator />

      <p>שינוי חריג בתשלום</p>
      <InputSides
        lblRight='שינוי >='
        lblLeft='%'
        name='achuzKfitzatPremiaBitucheiPrat'
        defaultValue={data.achuzKfitzatPremiaBitucheiPrat}
      />

      <Seperator />

      <p>לידים ללא פעולה מהפעילות האחרונה</p>
      <InputSides lblRight='מעל >=' lblLeft='חודשים' name='monthsLidimSheloHufku' defaultValue={data.monthsLidimSheloHufku} />

      <Seperator />

      <Subtitle lbl='לקוח ללא פעילות בשנה הקלנדרית (31.12 - 1.1)' />
      <Subtitle lbl='מוצר א' />
      <InputSides
        lblRight='הפקדה <'
        lblLeft='₪'
        name='schumKerenHishtalmutHafkadaAtzmaiLeloHafkada'
        defaultValue={data.schumKerenHishtalmutHafkadaAtzmaiLeloHafkada}
      />
      <Subtitle lbl='מוצר ב' />
      <InputSides
        lblRight='הפקדה <'
        lblLeft='%'
        name='achuzPensiaHafkadaAtzmaiLeloHafkada'
        defaultValue={data.achuzPensiaHafkadaAtzmaiLeloHafkada}
      />

      <Seperator />

      <Subtitle lbl='מוצרים חסרים' />
      <p>קבל התראה על מוצרים חסרים</p>

      <CheckboxBool lbl='מוצר א' name='isBituachHaimMutzarHaser' defaultChecked={data.isBituachHaimMutzarHaser} />
      <CheckboxBool lbl='מוצר ב' name='isBituachBriutMutzarHaser' defaultChecked={data.isBituachBriutMutzarHaser} />
      <CheckboxBool lbl='מוצר ג' name='isMahalotKashotMutzarHaser' defaultChecked={data.isMahalotKashotMutzarHaser} />
      <CheckboxBool lbl='מוצר ד' name='isGemelLehashkaaMutzarHaser' defaultChecked={data.isGemelLehashkaaMutzarHaser} />

      <Seperator />

      <Subtitle lbl='שיפור מעקב לקוח' />
      <p>לא בוצעו שינויים במוצר</p>
      <InputSides lblRight='מעל >=' lblLeft='חודשים' name='monthsUpdated' defaultValue={data.monthsUpdated} />

      <CheckboxBool lbl='מוצר ה' name='isRiskUpdated' defaultChecked={data.isRiskUpdated} />
      <CheckboxBool lbl='מוצר ו' name='isMahalotKashotUpdated' defaultChecked={data.isMahalotKashotUpdated} />

      <Btn lbl='שמירה' className='w-full mt-4' />
    </form>
  )
}
