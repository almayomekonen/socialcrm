'use client'
import { packages } from './Packages'

export default function PkgDetails({ curPkg }) {
  const pkg = packages.find((pkg) => pkg.name === curPkg)
  if (!pkg) return <p>לא נבחרה חבילה</p>

  return (
    <div className='space-y-1'>
      <p className='font-bold'>{pkg.name}</p>
      <p className='font-semibold'>{pkg.description}</p>
      {pkg.included.map((item, i) => (
        <span key={item}>
          {item}
          {i < pkg.included.length - 1 ? ', ' : '.'}
        </span>
      ))}
    </div>
  )
}
