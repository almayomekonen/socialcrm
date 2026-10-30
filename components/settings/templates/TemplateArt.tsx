import { useId } from 'react'
import { TRAIL, GREEN, BUBBLE_STROKE, bubble, Arrow, Defs, ContactCard } from './templateArtParts'
import { LEAD_SCENES } from './templateArtLeadScenes'
import { OTHER_SCENES } from './templateArtOtherScenes'

/**
 * One illustration per template, keyed by TEMPLATE KEY, with a neutral fallback
 * (scenes in templateArtLeadScenes / templateArtOtherScenes, shared parts in
 * templateArtParts).
 */
const SCENES: Record<string, (uid: string) => React.ReactNode> = { ...LEAD_SCENES, ...OTHER_SCENES }

/** Drawn when a template registers a key no scene has been designed for. */
function fallback(uid: string) {
  return (
    <>
      <ContactCard uid={uid} x={300} y={40} />
      <path d='M348 100c-6 16-40 6-64 8' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={276} y={108} angle={176} />
      <circle cx='90' cy='104' r='32' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 80, 120, 48)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='94' width='84' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='106' width='68' height='6' rx='3' fill='#4fb887' opacity='.3' />
    </>
  )
}

export default function TemplateArt({ templateKey }: { templateKey: string }) {
  const uid = useId().replace(/:/g, '')
  const scene = SCENES[templateKey] ?? fallback
  return (
    <svg
      viewBox='0 0 420 180'
      fill='none'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      /* Capped at its drawn size, so on desktop this is exactly 420×180 and on
         a narrow card the scene scales down rather than being cropped by the
         well's overflow. */
      className='h-auto w-full max-w-105'
    >
      <Defs uid={uid} />
      {scene(uid)}
    </svg>
  )
}
