export default function Loading() {
  return (
    <div className='flex h-screen items-center justify-center'>
      {/* <div className='animate-spin rounded-full size-32 border-t-2 border-b-2 border-dark' /> */}

      <div
        className='animate-spin rounded-full size-32 shadow-inner '
        style={{
          animationDuration: '0.7s',
          background: `conic-gradient(#2042F599 60deg, #FE6F42 100deg, #FE6F4290 120deg, transparent 200deg)`,
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), white 0)',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), white 0)',
        }}
      />
    </div>
  )
}

// #FE6F42
// #2042F5
