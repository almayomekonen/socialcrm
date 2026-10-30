import Portrait from '@/components/settings/art/Portrait'
import { CARD, TRAIL, GREEN, BUBBLE_STROKE, BAR, BAR_SOFT, bubble, Arrow, ContactCard } from './templateArtParts'

/** The form, appointment and internal templates' scenes (split out of TemplateArt; drawing unchanged). */
export const OTHER_SCENES: Record<string, (uid: string) => React.ReactNode> = {
  /*
   * תודה על פנייה מהטופס — the form is submitted, the submission is checked
   * off, and the thank-you goes straight out.
   */
  contact_form_thank_you: (uid) => (
    <>
      <g filter={`url(#${uid}e2)`}>
        <rect x='276' y='30' width='120' height='96' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <rect x='292' y='46' width='56' height='6' rx='3' fill={BAR} />
      <rect x='292' y='62' width='88' height='12' rx='6' fill='#f1f3f7' />
      <rect x='292' y='80' width='88' height='12' rx='6' fill='#f1f3f7' />
      <rect x='320' y='100' width='60' height='16' rx='6' fill={`url(#${uid}v)`} />
      <rect x='336' y='105' width='28' height='6' rx='3' fill='#fff' opacity='.55' />

      <path d='M274 92c-18 6-16 14-36 16' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={236} y={110} angle={168} />

      <circle cx='210' cy='104' r='20' fill='#25D366' opacity='.1' />
      <g filter={`url(#${uid}e2)`}>
        <circle cx='210' cy='104' r='14' fill='#fff' stroke={CARD} />
      </g>
      <path d='M204 104l4.4 4.6 8-9' stroke='#1f9d57' strokeWidth='2.2' />

      <path d='M192 112c-16 8-26 4-42 6' stroke={TRAIL} strokeDasharray='3 5' />

      <circle cx='84' cy='96' r='32' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 70, 112, 48)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='84' width='76' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='96' width='60' height='6' rx='3' fill='#4fb887' opacity='.3' />
    </>
  ),

  /*
   * תזכורת לפני פגישה — a date on the calendar, the clock counting down to
   * it, and the reminder landing before the meeting.
   */
  appointment_reminder: (uid) => (
    <>
      <g filter={`url(#${uid}e2)`}>
        <rect x='288' y='28' width='108' height='92' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <path d='M288 52h108' stroke={CARD} />
      <rect x='300' y='36' width='40' height='6' rx='3' fill={BAR} />
      <circle cx='378' cy='39' r='2.5' fill={BAR} />
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={300 + col * 22}
            y={62 + row * 18}
            width='14'
            height='10'
            rx='3'
            fill={row === 1 && col === 2 ? '#5e6ad2' : '#f1f3f7'}
          />
        )),
      )}

      <path d='M286 92c-14 10-16 8-30 10' stroke={TRAIL} strokeDasharray='3 5' />

      <circle cx='226' cy='104' r='30' fill='#5e6ad2' opacity='.07' />
      <g filter={`url(#${uid}e2)`}>
        <circle cx='226' cy='104' r='18' fill='#fff' stroke={CARD} />
      </g>
      <path d='M226 93v11l7 5' stroke='#5e6ad2' />

      <g filter={`url(#${uid}e2)`}>
        <rect x='108' y='30' width='120' height='44' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <circle cx='206' cy='52' r='12' fill='#fdf6ea' />
      <path
        d='M202 54c0-4.6.7-7 4-7s4 2.4 4 7M200.6 54h10.8M204.4 56.8a2 2 0 0 0 3.2 0'
        stroke='#c98a20'
      />
      <rect x='120' y='42' width='60' height='6' rx='3' fill={BAR} />
      <rect x='132' y='54' width='48' height='5' rx='2.5' fill={BAR_SOFT} />
      <path d='M226 82c-8 14-40 4-58 4' stroke={TRAIL} strokeDasharray='3 5' />

      <path d='M208 110c-22 8-44 2-62 4' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={138} y={114} angle={170} />

      <circle cx='72' cy='106' r='30' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 84, 96, 48)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='98' width='66' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='110' width='50' height='6' rx='3' fill='#4fb887' opacity='.3' />
    </>
  ),

  /*
   * משימה לנציג — a new lead lands and the rep gets a task with their name
   * on it. The only scene that ends inside the product rather than in a chat.
   */
  internal_task_on_new_lead: (uid) => (
    <>
      <ContactCard uid={uid} x={300} y={28} />
      <path d='M348 88c-2 16-34 6-58 8' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={284} y={98} angle={176} />

      <circle cx='166' cy='92' r='34' fill='#5e6ad2' opacity='.07' />
      <g filter={`url(#${uid}e2)`}>
        <rect x='96' y='52' width='152' height='80' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <rect x='112' y='66' width='58' height='6' rx='3' fill={BAR} />
      {[0, 1, 2].map((row) => {
        const y = 84 + row * 16
        const done = row === 0
        return (
          <g key={row}>
            <rect
              x='112'
              y={y}
              width='11'
              height='11'
              rx='3'
              fill={done ? '#5e6ad2' : '#fff'}
              stroke={done ? '#5e6ad2' : '#d9dee6'}
            />
            {done && <path d={`M114.6 ${y + 5.6}l2.2 2.2 4-4.4`} stroke='#fff' strokeWidth='1.6' />}
            <rect x='130' y={y + 3} width={row === 2 ? 60 : 92} height='5' rx='2.5' fill={BAR_SOFT} />
          </g>
        )
      })}
      <Portrait cx={226} cy={70} r={10} uid={uid} warm />

      <path d='M94 104c-12 8-22 6-32 8' stroke={TRAIL} strokeDasharray='3 5' />

      <g filter={`url(#${uid}e1)`}>
        <rect x='24' y='100' width='64' height='22' rx='11' fill='#fff' stroke={CARD} />
      </g>
      <circle cx='78' cy='111' r='3.5' fill='#5e6ad2' />
      <rect x='34' y='108' width='34' height='6' rx='3' fill={BAR_SOFT} />
    </>
  ),
}
