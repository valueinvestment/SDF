import { describe, it, expect } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { createUseStoreSlice } from "../useStoreSlice"

interface FakeState {
  count: number
  other: number
}

function makeFakeStore(initial: FakeState) {
  let state: unknown = initial
  const listeners = new Set<(s: unknown) => void>()
  return {
    getState: () => state,
    subscribe: (listener: (s: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setState: (patch: Partial<FakeState>) => {
      state = { ...(state as FakeState), ...patch }
      listeners.forEach((l) => l(state))
    },
  }
}

describe("createUseStoreSlice", () => {
  it("returns the selected slice", () => {
    const store = makeFakeStore({ count: 1, other: 10 })
    const useStoreSlice = createUseStoreSlice(store.getState, store.subscribe)

    function TestComponent() {
      const count = useStoreSlice((s) => (s as FakeState).count)
      return <div>{count}</div>
    }

    render(<TestComponent />)
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("does not re-render when an unrelated slice changes", () => {
    const store = makeFakeStore({ count: 1, other: 10 })
    const useStoreSlice = createUseStoreSlice(store.getState, store.subscribe)
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const count = useStoreSlice((s) => (s as FakeState).count)
      return <div>{count}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    act(() => {
      store.setState({ other: 999 })
    })
    expect(renderCount).toBe(1)
  })

  it("re-renders when the selected slice changes", () => {
    const store = makeFakeStore({ count: 1, other: 10 })
    const useStoreSlice = createUseStoreSlice(store.getState, store.subscribe)
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const count = useStoreSlice((s) => (s as FakeState).count)
      return <div>{count}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    act(() => {
      store.setState({ count: 2 })
    })
    expect(renderCount).toBe(2)
    expect(screen.getByText("2")).toBeInTheDocument()
  })

  it("does not re-render when a reference-typed selector's value survives a fresh structuredClone unchanged", () => {
    // Simulates the real app's behavior: apps/host-twin/lib/pluginBootstrap.ts's
    // createHostBindings() structuredClones the WHOLE store on every update, so
    // even an unrelated field change produces a brand new (but structurally
    // identical) array reference for `items`. Object.is would fail this test;
    // deep equality must pass it.
    interface CloneState {
      items: number[]
      other: number
    }
    let state: CloneState = { items: [1, 2, 3], other: 0 }
    const listeners = new Set<(s: unknown) => void>()
    const store = {
      getState: () => state,
      subscribe: (listener: (s: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      tick: (patch: Partial<CloneState>) => {
        state = structuredClone({ ...state, ...patch })
        listeners.forEach((l) => l(state))
      },
    }
    const useStoreSlice = createUseStoreSlice(store.getState, store.subscribe)
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const items = useStoreSlice((s) => (s as CloneState).items)
      return <div>{items.join(",")}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    act(() => {
      store.tick({ other: 999 })
    })
    expect(renderCount).toBe(1)
    expect(screen.getByText("1,2,3")).toBeInTheDocument()
  })

  it("re-renders when a reference-typed selector's value actually changes structurally", () => {
    interface CloneState {
      items: number[]
    }
    let state: CloneState = { items: [1, 2, 3] }
    const listeners = new Set<(s: unknown) => void>()
    const store = {
      getState: () => state,
      subscribe: (listener: (s: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      tick: (patch: Partial<CloneState>) => {
        state = structuredClone({ ...state, ...patch })
        listeners.forEach((l) => l(state))
      },
    }
    const useStoreSlice = createUseStoreSlice(store.getState, store.subscribe)
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const items = useStoreSlice((s) => (s as CloneState).items)
      return <div>{items.join(",")}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    act(() => {
      store.tick({ items: [1, 2, 3, 4] })
    })
    expect(renderCount).toBe(2)
    expect(screen.getByText("1,2,3,4")).toBeInTheDocument()
  })
})
