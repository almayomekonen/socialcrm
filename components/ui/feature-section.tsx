'use client'

import * as React from 'react'
import { motion, Variants } from 'motion/react'
import { cn } from '@/lib/utils'
import { Btn } from '@/lib/btns/Btn'

interface FeatureItem {
  text: string
  href?: string
}

interface FeatureCategory {
  icon: React.ReactNode
  title: string
  items: FeatureItem[]
}

export interface FeatureGridProps {
  title: React.ReactNode
  subtitle: string
  categories: FeatureCategory[]
  buttonText: string
  buttonHref: string
  className?: string
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 100, damping: 12 },
  },
}

export const FeatureGrid = React.forwardRef<HTMLDivElement, FeatureGridProps>(
  ({ title, subtitle, categories, buttonText, buttonHref, className }, ref) => {
    return (
      <section ref={ref} className={cn('w-full max-w-6xl mx-auto py-12 md:py-20 px-4', className)}>
        {/* Header */}
        <div className='mb-12 text-center' dir='rtl'>
          <h2 className='text-3xl md:text-4xl font-bold tracking-tight text-gray-900'>{title}</h2>
          <p className='mt-4 text-lg text-gray-500 max-w-xl mx-auto'>{subtitle}</p>
        </div>

        {/* Grid */}
        <motion.div
          className='rounded-xl border border-gray-200 bg-white p-6 md:p-8'
          initial='hidden'
          whileInView='visible'
          viewport={{ once: true, amount: 0.2 }}
          variants={containerVariants}
        >
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10' dir='rtl'>
            {categories.map((category, index) => (
              <motion.div key={index} variants={itemVariants} className='flex flex-col items-start'>
                <div className='mb-3'>{category.icon}</div>
                <h3 className='font-semibold text-gray-900 mb-2'>{category.title}</h3>
                <ul className='space-y-1.5 text-gray-500'>
                  {category.items.map((item, itemIndex) => (
                    <li key={itemIndex}>
                      {item.href ? (
                        <a
                          href={item.href}
                          className='hover:text-gray-900 hover:underline underline-offset-2 transition-colors'
                        >
                          {item.text}
                        </a>
                      ) : (
                        <span>{item.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className='mt-12'
          >
            <Btn href={buttonHref} lbl={buttonText} size='large' className='px-6 text-sm' />
          </motion.div>
        </motion.div>
      </section>
    )
  },
)

FeatureGrid.displayName = 'FeatureGrid'
