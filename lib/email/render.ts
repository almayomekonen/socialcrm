import { render } from '@react-email/render'
import { ReactElement } from 'react'

export function renderEmail(element: ReactElement) {
  return render(element)
}
