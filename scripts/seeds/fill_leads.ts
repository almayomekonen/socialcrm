import { db } from '@/config/db'

const USERS = [91, 208, 219, 234, 114, 72, 86, 191, 207]
const rand = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)]
const randDate = (start: Date, end: Date) =>
  new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
    .toISOString()
    .split('T')[0]

const phones = Array.from({ length: 200 }, (_, i) => `05${String(20000000 + i).padStart(8, '0')}`)
const emails = (name: string, i: number) =>
  `${name.replace(/\s+/g, '.').toLowerCase()}.${i}@gmail.com`

const genders = ['זכר', 'נקבה']
const familyStatuses = ['נשוי/ה', 'רווק/ה', 'גרוש/ה', 'אלמן/ה']
const leadSources = ['Facebook', 'Instagram', 'WhatsApp', 'אתר', 'המלצה', 'פרסום ממומן', 'אורגני']
const statuses = ['new', 'new', 'new', 'contacted', 'contacted', 'interested', 'closed', 'lost']

async function run() {
  const leads = await db('clients').where('lead', true).select('id', 'firstName', 'lastName', 'phone', 'email', 'gender', 'familyStatus', 'birthDate', 'leadSource', 'status', 'userId', 'handlerId')

  console.log(`Updating ${leads.length} leads...`)

  for (let i = 0; i < leads.length; i++) {
    const l = leads[i]
    const name = `${l.firstName || ''} ${l.lastName || ''}`.trim() || `lead${i}`

    await db('clients').where('id', l.id).update({
      phone:        l.phone        || phones[i] || `0521${String(i).padStart(6, '0')}`,
      email:        l.email        || emails(name, i),
      gender:       l.gender       || rand(genders),
      familyStatus: l.familyStatus || rand(familyStatuses),
      birthDate:    l.birthDate    || randDate(new Date('1975-01-01'), new Date('2000-12-31')),
      leadSource:   l.leadSource   || rand(leadSources),
      status:       l.status       || rand(statuses),
      userId:       l.userId       || rand(USERS),
      handlerId:    l.handlerId    || rand(USERS),
      statusChangedAt: randDate(new Date('2026-01-01'), new Date()),
    })

    if (i % 10 === 0) console.log(`  ${i + 1}/${leads.length}`)
  }

  console.log('Done.')
  await db.destroy()
}

run().catch((e) => { console.error(e.message); process.exit(1) })
