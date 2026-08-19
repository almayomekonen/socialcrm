export function Pulse({ className }: { className: string }) {
  return <div className={`bg-gray-100 motion-safe:animate-pulse ${className}`} />
}

export function Status({ children }: { children: string }) {
  return (
    <span className='sr-only' role='status'>
      {children}
    </span>
  )
}
