'use client'

import { useState } from 'react'

export function useAction() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      await fn()
    } catch {
      setError('משהו השתבש, נסה שוב')
    } finally {
      setLoading(false)
    }
  }

  return { loading, error, setError, run }
}
