import Portrait from '@/components/settings/art/Portrait'
import { CARD, TRAIL, GREEN, BUBBLE_STROKE, BAR, BAR_SOFT, TEXT_STRONG, TEXT_SOFT, bubble, Arrow, ContactCard } from './templateArtParts'

/** The lead templates' scenes (split out of TemplateArt; drawing unchanged). */
export const LEAD_SCENES: Record<string, (uid: string) => React.ReactNode> = {
  /*
   * רצף קבלת פנים — the contact arrives top right, the immediate message is
   * lit, and the later two recede down the dotted timeline.
   */
  welcome_sequence: (uid) => (
    <>
      <path d='M292 136H32' stroke='#e6e9ef' strokeDasharray='1 7' />
      <ContactCard uid={uid} x={300} y={24} />
      <path d='M348 84c0 16-32 4-56 4' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={284} y={88} angle={180} />

      <circle cx='232' cy='136' r='14' fill={GREEN} opacity='.12' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(188, 60, 88, 56)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='200' y='76' width='60' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='212' y='90' width='48' height='6' rx='3' fill='#4fb887' opacity='.3' />
      <path d='M232 120v8' stroke='#a8ddc3' strokeDasharray='2 4' />
      <circle cx='232' cy='136' r='5' fill={GREEN} />

      <g filter={`url(#${uid}e1)`}>
        <rect x='108' y='72' width='72' height='44' rx='12' fill='#fff' stroke={CARD} />
      </g>
      <rect x='118' y='84' width='44' height='6' rx='3' fill={BAR} />
      <rect x='128' y='96' width='34' height='5' rx='2.5' fill={BAR_SOFT} />
      <path d='M144 120v8' stroke={BAR} strokeDasharray='2 4' />
      <circle cx='144' cy='136' r='4.5' fill='#d3d8e0' />

      <rect x='24' y='82' width='64' height='34' rx='12' fill='#fff' stroke={BAR_SOFT} />
      <rect x='34' y='92' width='38' height='5' rx='2.5' fill={BAR_SOFT} />
      <rect x='42' y='102' width='30' height='5' rx='2.5' fill='#f4f6f9' />
      <path d='M56 120v8' stroke={BAR_SOFT} strokeDasharray='2 4' />
      <circle cx='56' cy='136' r='4.5' fill='#dfe3e9' />

      <text x='232' y='152' textAnchor='middle' fontSize='12' fontWeight='600' fill={TEXT_STRONG} direction='rtl'>
        מיד
      </text>
      <text x='144' y='152' textAnchor='middle' fontSize='12' fill={TEXT_SOFT} direction='rtl'>
        יום 2
      </text>
      <text x='56' y='152' textAnchor='middle' fontSize='12' fill={TEXT_SOFT} direction='rtl'>
        יום 7
      </text>
    </>
  ),

  /*
   * מעקב אחרי ליד מהאתר — a real browser with a form and a cursor on the
   * submit button; the lead card flies out and becomes a message.
   */
  website_lead_follow_up: (uid) => (
    <>
      <g filter={`url(#${uid}e2)`}>
        <rect x='252' y='24' width='144' height='88' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <path d='M252 48h144' stroke={CARD} />
      <circle cx='264' cy='36' r='2.5' fill={BAR} />
      <circle cx='274' cy='36' r='2.5' fill={BAR} />
      <circle cx='284' cy='36' r='2.5' fill={BAR} />
      <rect x='296' y='31' width='92' height='10' rx='5' fill='#f1f3f7' />
      <rect x='268' y='60' width='112' height='10' rx='5' fill='#f1f3f7' />
      <rect x='300' y='76' width='80' height='10' rx='5' fill='#f1f3f7' />
      <rect x='320' y='92' width='60' height='16' rx='6' fill={`url(#${uid}v)`} />
      <rect x='336' y='97' width='28' height='6' rx='3' fill='#fff' opacity='.55' />
      <path d='M330 100l10 13 1.5-5.5 5.5-1.5z' fill='#fff' stroke='#08203a' />

      <g transform='rotate(-4 192 72)'>
        <g filter={`url(#${uid}e2)`}>
          <rect x='144' y='48' width='96' height='48' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
        </g>
        <Portrait cx={222} cy={66} r={9} uid={uid} />
        <rect x='156' y='60' width='46' height='6' rx='3' fill={BAR} />
        <rect x='166' y='72' width='36' height='5' rx='2.5' fill={BAR_SOFT} />
      </g>
      <path d='M250 62h-8M252 76h-6' stroke='#d3d8e0' />

      <path d='M144 86c-20 10-16 16-38 20' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={106} y={106} angle={160} />
      <circle cx='124' cy='100' r='13' fill='#5e6ad2' opacity='.12' />
      <path d='M124 92l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4z' fill='#5e6ad2' />

      <circle cx='72' cy='122' r='30' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 98, 96, 48)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='112' width='66' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='124' width='50' height='6' rx='3' fill='#4fb887' opacity='.3' />
    </>
  ),

  /*
   * מעקב אחרי ליד שאבד — the contact has gone cold, a reminder waits on the
   * clock, and one message brings a reply back.
   */
  lost_lead_follow_up: (uid) => (
    <>
      <ContactCard uid={uid} x={300} y={24} status='cold' warm />
      <path d='M348 84c-4 14-40 6-62 10' stroke={TRAIL} strokeDasharray='3 5' />

      <circle cx='256' cy='100' r='30' fill='#5e6ad2' opacity='.07' />
      <g filter={`url(#${uid}e2)`}>
        <circle cx='256' cy='100' r='18' fill='#fff' stroke={CARD} />
      </g>
      <path d='M256 89v11l7 5' stroke='#5e6ad2' />
      <path d='M256 78c-22 0-30-14-48-14' stroke='#dfe3e9' strokeDasharray='3 5' />

      <g filter={`url(#${uid}e2)`}>
        <rect x='132' y='28' width='120' height='44' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <circle cx='230' cy='50' r='12' fill='#fdf6ea' />
      <path
        d='M226 52c0-4.6.7-7 4-7s4 2.4 4 7M224.6 52h10.8M228.4 54.8a2 2 0 0 0 3.2 0'
        stroke='#c98a20'
      />
      <rect x='144' y='40' width='60' height='6' rx='3' fill={BAR} />
      <rect x='156' y='52' width='48' height='5' rx='2.5' fill={BAR_SOFT} />

      <path d='M238 106c-24 8-50 2-74 4' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={156} y={110} angle={170} />

      <circle cx='76' cy='98' r='32' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 76, 112, 44)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='88' width='76' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='100' width='60' height='6' rx='3' fill='#4fb887' opacity='.3' />

      <g filter={`url(#${uid}e1)`}>
        <rect x='24' y='134' width='64' height='22' rx='11' fill='#fff' stroke={CARD} />
      </g>
      <circle cx='78' cy='145' r='3.5' fill={GREEN} />
      <rect x='34' y='142' width='34' height='6' rx='3' fill={BAR_SOFT} />
    </>
  ),
}
