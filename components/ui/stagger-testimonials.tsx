'use client'

import React, { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import Icon from '@/lib/Icon'

const SQRT_5000 = Math.sqrt(5000)

const testimonials = [
  {
    tempId: 0,
    testimonial: 'לפני SocialCRM הייתי מאבד לידים כל יום. היום פותח את המערכת בבוקר ויודע בדיוק מה צריך טיפול. שום דבר לא נופל בין הכיסאות.',
    by: 'רועי כהן, בעל עסק לשיפוצים',
    initials: 'אבי',
    color: '#3f20f5',
  },
  {
    tempId: 1,
    testimonial: 'ייבאתי 200 לידים מאקסל תוך דקה אחת. כל הנציגים עובדים ממקום אחד ולא מפספסים שום ליד. שיפרנו את אחוז הסגירה ב-30%.',
    by: 'מיכל לוי, מנהלת מכירות בחברת נדל"ן',
    initials: 'מלי',
    color: '#7c3aed',
  },
  {
    tempId: 2,
    testimonial: 'חיברנו את דף הפייסבוק ומאז כל ליד מגיע ישירות למערכת. לא צריך יותר להעתיק שמות ומספרים ידנית.',
    by: 'אמיר בן דוד, מנהל קמפיינים דיגיטליים',
    initials: 'יואב',
    color: '#0369a1',
  },
  {
    tempId: 3,
    testimonial: 'הנציגים שלי סוף סוף יודעים מה שלהם ומה לא. אין יותר בלבול על מי מטפל במי. פשוט עובד.',
    by: 'שירה אבגי, מנהלת צוות מכירות',
    initials: 'שרה',
    color: '#0f766e',
  },
  {
    tempId: 4,
    testimonial: 'תוך שבוע ראיתי שיש לנו עשרות לידים שאף אחד לא טיפל בהם. עם SocialCRM אין יותר לידים שנשכחים.',
    by: 'יוני פרץ, יועץ פיננסי',
    initials: 'יון',
    color: '#b45309',
  },
  {
    tempId: 5,
    testimonial: 'ניסיתי אקסל, ניסיתי מחברת, ניסיתי קבוצת וואטסאפ. כלום לא עבד. SocialCRM הוא הדבר הראשון שבאמת עוזר.',
    by: 'נטע גולן, עצמאית בתחום הנדל"ן',
    initials: 'נטע',
    color: '#be185d',
  },
  {
    tempId: 6,
    testimonial: 'ההגדרה הייתה פשוטה, ובפחות מ-5 דקות כבר ראיתי את כל הלידים שלי מאורגנים. לא ציפיתי שיהיה כל כך קל.',
    by: 'דרור שמש, בעל מכון כושר',
    initials: 'דרור',
    color: '#15803d',
  },
]

interface TestimonialCardProps {
  position: number
  testimonial: (typeof testimonials)[0]
  handleMove: (steps: number) => void
  cardSize: number
}

const TestimonialCard: React.FC<TestimonialCardProps> = ({ position, testimonial, handleMove, cardSize }) => {
  const isCenter = position === 0

  return (
    <div
      onClick={() => handleMove(position)}
      className={cn(
        'absolute left-1/2 top-1/2 cursor-pointer border-2 p-8 transition-all duration-500 ease-in-out',
        isCenter ? 'z-10' : 'z-0',
      )}
      style={{
        width: cardSize,
        height: cardSize,
        backgroundColor: isCenter ? '#3f20f5' : '#1a1530',
        borderColor: isCenter ? '#3f20f5' : 'rgba(255,255,255,0.1)',
        clipPath: `polygon(50px 0%, calc(100% - 50px) 0%, 100% 50px, 100% 100%, calc(100% - 50px) 100%, 50px 100%, 0 100%, 0 0)`,
        transform: `
          translate(-50%, -50%)
          translateX(${(cardSize / 1.5) * position}px)
          translateY(${isCenter ? -65 : position % 2 ? 15 : -15}px)
          rotate(${isCenter ? 0 : position % 2 ? 2.5 : -2.5}deg)
        `,
        boxShadow: isCenter ? '0px 8px 0px 4px rgba(63,32,245,0.3)' : '0px 0px 0px 0px transparent',
      }}
      dir='rtl'
    >
      <span
        className='absolute block origin-top-right rotate-45'
        style={{
          right: -2,
          top: 48,
          width: SQRT_5000,
          height: 2,
          backgroundColor: isCenter ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
        }}
      />
      <div
        className='mb-4 flex h-14 w-12 items-center justify-center text-lg font-bold text-white'
        style={{ backgroundColor: testimonial.color, boxShadow: '3px 3px 0px rgba(0,0,0,0.4)' }}
      >
        {testimonial.initials}
      </div>
      <h3 className={cn('text-base sm:text-xl font-medium leading-relaxed', isCenter ? 'text-white' : 'text-white/70')}>
        &ldquo;{testimonial.testimonial}&rdquo;
      </h3>
      <p className={cn('absolute bottom-8 left-8 right-8 mt-2 text-sm italic', isCenter ? 'text-white/70' : 'text-white/40')}>
        — {testimonial.by}
      </p>
    </div>
  )
}

export const StaggerTestimonials: React.FC = () => {
  const [cardSize, setCardSize] = useState(365)
  const [testimonialsList, setTestimonialsList] = useState(testimonials)

  const handleMove = (steps: number) => {
    const newList = [...testimonialsList]
    if (steps > 0) {
      for (let i = steps; i > 0; i--) {
        const item = newList.shift()
        if (!item) return
        newList.push({ ...item, tempId: Math.random() })
      }
    } else {
      for (let i = steps; i < 0; i++) {
        const item = newList.pop()
        if (!item) return
        newList.unshift({ ...item, tempId: Math.random() })
      }
    }
    setTestimonialsList(newList)
  }

  useEffect(() => {
    const updateSize = () => {
      const { matches } = window.matchMedia('(min-width: 640px)')
      setCardSize(matches ? 365 : 290)
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  return (
    <div className='relative w-full overflow-hidden' style={{ height: 600, backgroundColor: '#0a0a0a' }}>
      {/* Left fade */}
      <div
        className='pointer-events-none absolute inset-y-0 left-0 z-20'
        style={{ width: '20%', background: 'linear-gradient(to right, #0a0a0a 0%, transparent 100%)' }}
      />
      {/* Right fade */}
      <div
        className='pointer-events-none absolute inset-y-0 right-0 z-20'
        style={{ width: '20%', background: 'linear-gradient(to left, #0a0a0a 0%, transparent 100%)' }}
      />
      {testimonialsList.map((testimonial, index) => {
        const position =
          testimonialsList.length % 2
            ? index - (testimonialsList.length - 1) / 2
            : index - testimonialsList.length / 2
        return (
          <TestimonialCard
            key={testimonial.tempId}
            testimonial={testimonial}
            handleMove={handleMove}
            position={position}
            cardSize={cardSize}
          />
        )
      })}
      <div className='absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2'>
        <button
          onClick={() => handleMove(1)}
          className='flex h-14 w-14 items-center justify-center border-2 transition-colors'
          style={{ backgroundColor: '#1a1530', borderColor: 'rgba(255,255,255,0.15)' }}
          aria-label='Previous testimonial'
        >
          <Icon name='chevron-right' className='size-5 bg-white/60' />
        </button>
        <button
          onClick={() => handleMove(-1)}
          className='flex h-14 w-14 items-center justify-center border-2 transition-colors'
          style={{ backgroundColor: '#1a1530', borderColor: 'rgba(255,255,255,0.15)' }}
          aria-label='Next testimonial'
        >
          <Icon name='chevron-left' className='size-5 bg-white/60' />
        </button>
      </div>
    </div>
  )
}
