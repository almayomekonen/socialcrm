'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import { UserDb } from '@/db/auth'
import { createContext, useContext } from 'react'
import { fetchLeadsSince } from '@/actions/clients'
import {
  LEAD_POLL_FOCUSED_MS,
  LEAD_POLL_HIDDEN_MS,
  LEAD_POLL_MAX_IDLE,
  nextInterval,
} from '@/lib/polling/pollSchedule'

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

export function useLeadPolling(onNewLeads: (leads: any[]) => void, enabled = true, initialLastSeenAt?: string) {
  const lastSeenAtRef = useRef(initialLastSeenAt ?? new Date().toISOString())
  const onNewLeadsRef = useRef(onNewLeads)
  onNewLeadsRef.current = onNewLeads

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let idleStreak = 0
    let inFlight = false

    const schedule = () => {
      if (cancelled) return
      const ms = nextInterval({
        hidden: typeof document !== 'undefined' && document.hidden,
        idleStreak,
        focusedMs: LEAD_POLL_FOCUSED_MS,
        hiddenMs: LEAD_POLL_HIDDEN_MS,
        maxIdle: LEAD_POLL_MAX_IDLE,
      })
      if (process.env.NODE_ENV === 'development') {
        console.debug('[leads.poll]', { ms, idleStreak, hidden: document.hidden })
      }
      timer = setTimeout(() => {
        void tick()
      }, ms)
    }

    const tick = async () => {
      if (cancelled) return
      if (inFlight) {
        schedule()
        return
      }
      inFlight = true
      let changed = false
      let failed = false
      try {
        const leads = await fetchLeadsSince(lastSeenAtRef.current)
        if (leads.length > 0) {
          changed = true
          lastSeenAtRef.current = leads.reduce((max, l) => {
            const ts = new Date(l.updatedAt).toISOString()
            return ts > max ? ts : max
          }, lastSeenAtRef.current)
          onNewLeadsRef.current(leads)
        }
      } catch (err) {
        failed = true
        console.warn('[leads.poll]', {
          err: err instanceof Error ? err.name : 'unknown',
        })
        // Transport errors do not count as idle (A6 recovery band owns outages).
      } finally {
        inFlight = false
        if (!failed) {
          idleStreak = changed ? 0 : idleStreak + 1
        }
        schedule()
      }
    }

    const onVisibility = () => {
      if (!document.hidden) {
        idleStreak = 0
        if (timer) clearTimeout(timer)
        void tick()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    // First tick shortly after mount — same spirit as inbox adaptive poll.
    timer = setTimeout(() => {
      void tick()
    }, 500)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])
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
  return context as UserDb
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
  return context
}
