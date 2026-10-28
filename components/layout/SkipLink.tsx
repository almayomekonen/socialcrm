// Skip link — WCAG 2.4.1 Bypass Blocks. Rendered as the first focusable element
// in the app shell so keyboard users can jump past the sidebar nav straight to
// the page content. Visually hidden until it receives focus, then revealed as a
// normal, high-contrast control. Targets <main id="main-content"> in the layout.
// `label` comes from the workspace's interface language; marketing and support
// render it without one and keep the Hebrew default.
export default function SkipLink({ label = 'דלג לתוכן' }: { label?: string }) {
  return (
    <a
      href='#main-content'
      className='sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[9999] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:font-medium focus:text-primary-text focus:shadow-md focus:outline focus:outline-2 focus:outline-primary'
    >
      {label}
    </a>
  )
}
