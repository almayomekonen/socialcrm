'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A label whose box animates to the width of its new text, so a pill control
 * that changes its own label grows into the new word instead of snapping and
 * shoving its neighbours sideways.
 *
 * The measuring copy is `invisible`, not `hidden`: it has to be laid out to have
 * an `offsetWidth` to read.
 */
export default function MorphingText({ text }: { text: string }) {
  const [width, setWidth] = useState<number | 'auto'>('auto')
  const spanRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (spanRef.current) setWidth(spanRef.current.offsetWidth)
  }, [text])

  return (
    <span
      className='relative inline-flex items-center justify-center overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]'
      style={{ width }}
    >
      <span ref={spanRef} className='invisible whitespace-nowrap px-1'>
        {text}
      </span>
      <span
        key={text}
        className='absolute inset-0 flex items-center justify-center whitespace-nowrap animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none'
      >
        {text}
      </span>
    </span>
  )
}
