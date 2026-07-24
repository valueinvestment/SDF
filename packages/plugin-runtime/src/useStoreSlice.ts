import { useSyncExternalStore, useRef, useCallback } from "react"

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aKeys = Object.keys(a as object)
  const bKeys = Object.keys(b as object)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }
  return true
}

export function createUseStoreSlice(
  getState: () => unknown,
  subscribe: (listener: (state: unknown) => void) => () => void,
) {
  return function useStoreSlice<T>(selector: (state: unknown) => T): T {
    const selectorRef = useRef(selector)
    selectorRef.current = selector
    const lastValueRef = useRef<{ value: T } | null>(null)

    const getSnapshot = useCallback(() => {
      const next = selectorRef.current(getState())
      if (lastValueRef.current && deepEqual(lastValueRef.current.value, next)) {
        return lastValueRef.current.value
      }
      lastValueRef.current = { value: next }
      return next
    }, [])

    const subscribeToStore = useCallback(
      (onStoreChange: () => void) => subscribe(() => onStoreChange()),
      [],
    )

    return useSyncExternalStore(subscribeToStore, getSnapshot)
  }
}
