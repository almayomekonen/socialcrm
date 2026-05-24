import { render } from '@react-email/render'
import { ReactElement } from 'react'

export function renderEmail(element: ReactElement) {
  return render(element)
}

export function renderEmailText(element: ReactElement) {
  return render(element, { plainText: true })
}
