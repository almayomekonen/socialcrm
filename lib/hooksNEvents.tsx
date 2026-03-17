'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import { UserDb } from '@/db/auth'
import { createContext, useContext } from 'react'

// events:

export default function LayoutPageEvents() {
  useEffect(() => {
    // prevent the input number from changing value when user scrolls
    function handleWheel(e: WheelEvent) {
      const target = e.target as HTMLInputElement
      if (document.activeElement === target && target.type === 'number') target.blur()
    }

    document.addEventListener('wheel', handleWheel, { passive: true })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [])

  return null
}

// hooks:

export function useDebounce(callback: (...args: any[]) => void, delay = 1000) {
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current)
      }
    }
  }, [])

  const debouncedCallback = useCallback(
    (...args: any[]) => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current)

      timeoutIdRef.current = setTimeout(() => {
        callback(...args)
      }, delay)
    },
    [callback, delay]
  )

  return debouncedCallback
}

export function debounce(callback, delay = 1000) {
  let timeoutId = null

  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId)

    timeoutId = setTimeout(() => {
      callback(...args)
    }, delay)
  }
}

export function useKeepTblScrollPos(tblId: string) {
  const { positions, setScrollPosition } = usePos()

  const onScroll = useDebounce((tbl: HTMLElement) => {
    setScrollPosition(tblId, tbl.scrollTop)
  }, 500)

  useEffect(() => {
    const tbl = document.getElementById(tblId)
    if (!tbl) return
    if (positions[tblId]) {
      tbl.scrollTo({ top: positions[tblId], behavior: 'smooth' })
    }
    const scrollHandler = () => onScroll(tbl)
    tbl.addEventListener('scroll', scrollHandler, { passive: true })

    return () => {
      tbl.removeEventListener('scroll', scrollHandler)
    }
  }, [])
}

let dragIndex: number, enterIndex: number

export const useDrag = (arr, index, onDragEnd) => {
  const handleDragEnd = () => {
    const dragItem = arr.splice(dragIndex, 1)[0]
    arr.splice(enterIndex, 0, dragItem)
    onDragEnd()
  }

  return {
    draggable: true,
    onDragStart: () => (dragIndex = index),
    onDragEnter: () => (enterIndex = index),
    onDragEnd: handleDragEnd,
    onDragOver: (e) => e.preventDefault(),
  }
}

// user
const UserContext = createContext<UserDb | null>(null)

export function UserProvider({ children, user }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}

export function useUser() {
  const context = useContext(UserContext)
  if (context === null) throw new Error('useUser must be used within a UserProvider')

  return context
}

// pos
const PosCtx = createContext<{
  positions: { [key: string]: number }
  setScrollPosition: (tblId: string, pos: number) => void
} | null>(null)

type Props = {
  children: React.ReactNode
}

export function PosProvider({ children }: Props) {
  const [positions, setPositions] = useState<{ [key: string]: number }>({})
  const setScrollPosition = (tblId: string, pos: number) => {
    setPositions((prev) => ({ ...prev, [tblId]: pos }))
  }

  return <PosCtx.Provider value={{ positions, setScrollPosition }}>{children}</PosCtx.Provider>
}

export function usePos() {
  const context = useContext(PosCtx)
  if (context === null) throw new Error('usePos must be used within a PosProvider')

  return context
}

// provider
const PageCtx = createContext<any>(null)

type ProviderProps = {
  className?: string
  children: React.ReactNode
  props: {
    tableLength?: number
    params?: any
    [key: string]: any
  }
}

export function Provider({ children, props, className }: ProviderProps) {
  const [state, setState] = useState()

  return (
    <PageCtx.Provider value={{ ...props, state, setState }}>
      <div className={className}>{children}</div>
    </PageCtx.Provider>
  )
}

export function useProps() {
  const context = useContext(PageCtx)
  if (context === null) throw new Error('useProps must be used within a Provider')

  return context
}
