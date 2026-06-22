import Image from 'next/image'

type Channel = 'whatsapp' | 'instagram' | 'facebook'

const CHANNEL_TINT: Record<Channel, string> = {
  whatsapp: '#25D366',
  instagram: '#E1306C',
  facebook: '#1877F2',
}

interface NewLeadRowProps {
  channel: Channel
  name: string
  message: string
}

// An incoming lead, as it lands from a social channel. Presentational only —
// motion is owned by HeroScene.
export function NewLeadRow({ channel, name, message }: NewLeadRowProps) {
  return (
    <div
      dir='rtl'
      className='flex w-56 items-center gap-3 rounded-2xl border border-black/5 bg-white p-3 shadow-[0_8px_30px_rgba(23,20,36,0.12)]'
    >
      <Image
        src={`/media/social/${channel}.png`}
        alt=''
        width={28}
        height={28}
        className='shrink-0 rounded-lg'
      />
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-semibold text-gray-900'>{name}</p>
        <p className='truncate text-xs text-gray-500'>{message}</p>
      </div>
      <span
        className='size-2.5 shrink-0 rounded-full'
        style={{ backgroundColor: CHANNEL_TINT[channel] }}
      />
    </div>
  )
}
