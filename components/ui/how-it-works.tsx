'use client'

import { cn } from '@/lib/utils'
import Icon, { IconNames } from '@/lib/Icon'
import type React from 'react'

interface StepCardProps {
  iconName: IconNames
  title: string
  description: string
  benefits: string[]
}

const StepCard: React.FC<StepCardProps> = ({ iconName, title, description, benefits }) => (
  <div
    className={cn(
      'relative rounded-2xl border border-white/10 p-6 text-white transition-all duration-300 ease-in-out',
      'hover:scale-105 hover:shadow-2xl hover:border-white/20',
    )}
    style={{ backgroundColor: '#1a1530' }}
  >
    <div
      className='mb-5 flex h-12 w-12 items-center justify-center rounded-xl'
      style={{ backgroundColor: '#2a2040' }}
    >
      <Icon name={iconName} className='size-6 bg-white/80' />
    </div>

    <h3 className='mb-2 text-xl font-bold text-white'>{title}</h3>
    <p className='mb-6 text-sm leading-relaxed text-white/50'>{description}</p>

    <ul className='space-y-3'>
      {benefits.map((benefit, index) => (
        <li key={index} className='flex items-center gap-3'>
          <div className='flex h-4 w-4 shrink-0 items-center justify-center rounded-full' style={{ backgroundColor: 'rgba(63,32,245,0.25)' }}>
            <div className='h-2 w-2 rounded-full' style={{ backgroundColor: '#3f20f5' }} />
          </div>
          <span className='text-sm text-white/50'>{benefit}</span>
        </li>
      ))}
    </ul>
  </div>
)

interface HowItWorksProps extends React.HTMLAttributes<HTMLElement> {}

export const HowItWorks: React.FC<HowItWorksProps> = ({ className, ...props }) => {
  const stepsData = [
    {
      iconName: 'file-import' as IconNames,
      title: 'מייבאים את הלידים',
      description: 'מעלים קובץ אקסל קיים או מחברים את דף הפייסבוק. תוך 60 שניות כל הלידים מאורגנים.',
      benefits: ['ייבוא מאקסל בלחיצה אחת', 'חיבור אוטומטי לפייסבוק ואינסטגרם', 'לידים מוואטסאפ בקלות'],
    },
    {
      iconName: 'users' as IconNames,
      title: 'מחלקים ומעדכנים',
      description: 'משייכים לידים לנציגים, מעדכנים סטטוס אחרי כל שיחה, ומוסיפים הערות.',
      benefits: ['שיוך לנציגים בלחיצה', 'עדכון סטטוס חדש, בטיפול, סגור, אבוד', 'הוספת הערות לכל ליד'],
    },
    {
      iconName: 'circle-check' as IconNames,
      title: 'סוגרים יותר עסקאות',
      description: 'פותחים את המערכת בכל בוקר, רואים מה דחוף, ולא מפספסים אף הזדמנות.',
      benefits: ['רואים מיד מה צריך טיפול', 'לא מפספסים אף ליד', 'דוחות מכירות בלחיצה אחת'],
    },
  ]

  return (
    <section
      id='how-it-works'
      className={cn('w-full py-20 sm:py-28', className)}
      style={{ backgroundColor: '#171424' }}
      dir='rtl'
      {...props}
    >
      <div className='mx-auto w-full max-w-5xl px-6'>
        {/* Header */}
        <div className='mx-auto mb-16 max-w-4xl text-center'>
          <h2 className='text-4xl font-black tracking-tight text-white sm:text-5xl'>
            איך זה עובד
          </h2>
          <p className='mt-4 text-lg text-white/40'>
            מההרשמה ועד לניהול מלא, תוך פחות מ-5 דקות
          </p>
        </div>

        {/* Step numbers with connecting line */}
        <div className='relative mx-auto mb-8 w-full max-w-4xl'>
          <div
            aria-hidden='true'
            className='absolute top-1/2 -translate-y-1/2 h-px'
            style={{
              left: '16.6667%',
              width: '66.6667%',
              backgroundColor: 'rgba(255,255,255,0.1)',
            }}
          />
          <div className='relative grid grid-cols-3'>
            {stepsData.map((_, index) => (
              <div
                key={index}
                className='flex h-8 w-8 items-center justify-center justify-self-center rounded-full text-sm font-bold text-white ring-4 ring-dark'
                style={{ backgroundColor: '#2a2040' }}
              >
                {index + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div className='mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-3'>
          {stepsData.map((step, index) => (
            <StepCard
              key={index}
              iconName={step.iconName}
              title={step.title}
              description={step.description}
              benefits={step.benefits}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
