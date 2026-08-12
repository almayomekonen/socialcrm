import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './ui/**/*.{js,ts,jsx,tsx,mdx}',
    './utils/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './auth/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      /**
       * Device bands. `tablet` closes a real dead zone: before it existed,
       * 768–999px matched NEITHER `mobile` (max 767) NOR `desktop` (min 1000),
       * so every `mobile:` and `desktop:` utility silently did nothing across a
       * 232px range that includes the iPad portrait width (768) and small
       * laptop windows.
       *
       * Added PURELY ADDITIVELY on purpose: `mobile` and `desktop` keep their
       * exact previous bounds, so no existing utility anywhere in the codebase
       * changes meaning. Widening `desktop` to 768px instead would have
       * retroactively altered every `desktop:` class in the app — a silent
       * desktop-wide regression, which is why it was rejected.
       */
      screens: {
        mobile: { min: '0px', max: '767px' },
        tablet: { min: '768px', max: '999px' },
        desktop: { min: '1000px' },
        '3xl': { min: '1800px', max: '1920px' },
      },
    },
  },
}

export default config
