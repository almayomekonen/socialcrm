'use client'

import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react'

/**
 * Optional trailing control for `MobileHeader`, set by the screen that is
 * currently mounted (e.g. populated Leads registers +). Default is a no-op so
 * a screen rendered outside the mobile shell cannot crash — it simply has no
 * header slot to occupy.
 *
 * State lives in `MobileWorkspaceShell` so the header and the page stay
 * siblings; this module is only the wiring.
 */
export const MobileHeaderActionContext = createContext<Dispatch<SetStateAction<ReactNode>>>(() => {})

export function useSetMobileHeaderAction() {
  return useContext(MobileHeaderActionContext)
}
