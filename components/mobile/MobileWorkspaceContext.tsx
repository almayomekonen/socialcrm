'use client'

import { createContext } from 'react'

/**
 * True only inside `MobileWorkspaceShell`. Default false is the desktop entity.
 *
 * Route `loading.tsx` must not call `headers()` / `getDeviceClass()` — under
 * Cache Components that makes the fallback a dynamic hole that can stay mounted
 * after client navigation. The already-mounted shell is the entity signal.
 */
export const MobileWorkspaceContext = createContext(false)
