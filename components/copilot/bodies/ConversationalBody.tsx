'use client'

import type { ConversationalReply } from '@/lib/ai/prompts/conversationalReply'

export function ConversationalBody({ data }: { data: ConversationalReply }) {
  return (
    <div className='pt-1 text-[13px] leading-relaxed text-gray-900' dir='auto'>
      {data.reply}
    </div>
  )
}
