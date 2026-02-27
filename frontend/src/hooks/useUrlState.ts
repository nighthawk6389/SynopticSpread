import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Sync a single query-string parameter with React state.
 * When the value equals `defaultValue` the param is removed from the URL.
 */
export function useUrlState(
  key: string,
  defaultValue: string,
): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()

  const raw = searchParams.get(key)
  const value = raw ?? defaultValue

  const setValue = useCallback(
    (next: string) => {
      setSearchParams(
        prev => {
          const updated = new URLSearchParams(prev)
          if (next === defaultValue) {
            updated.delete(key)
          } else {
            updated.set(key, next)
          }
          return updated
        },
        { replace: true },
      )
    },
    [key, defaultValue, setSearchParams],
  )

  return [value, setValue]
}
