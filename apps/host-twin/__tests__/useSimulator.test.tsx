import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useSimulator } from "@/hooks/useSimulator"
import { useFactoryStore } from "@/store/factoryStore"

describe("useSimulator — 배속 변환 메모리 누수 점검", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useFactoryStore.setState({
      placedEntities: [],
      workOrders: {},
      workOrderQueues: {},
    })
    useFactoryStore.getState().setSimTimeScale(1)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("keeps exactly one active interval across repeated speed changes (no leak)", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval")
    const clearSpy = vi.spyOn(globalThis, "clearInterval")

    const { unmount } = renderHook(() => useSimulator({ wsConnected: false }))

    // 배속을 여러 번 전환
    act(() => { useFactoryStore.getState().setSimTimeScale(2) })
    act(() => { useFactoryStore.getState().setSimTimeScale(5) })
    act(() => { useFactoryStore.getState().setSimTimeScale(1) })

    // 각 전환마다 기존 인터벌 clear + 새 인터벌 set → 활성 인터벌은 항상 1개
    const active = setSpy.mock.calls.length - clearSpy.mock.calls.length
    expect(active).toBe(1)

    // 언마운트 시 마지막 인터벌까지 정리되어야 함 (활성 0)
    act(() => { unmount() })
    expect(setSpy.mock.calls.length - clearSpy.mock.calls.length).toBe(0)
  })

  it("does not start an interval while the WebSocket is connected", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval")
    const { unmount } = renderHook(() => useSimulator({ wsConnected: true }))
    expect(setSpy).not.toHaveBeenCalled()
    act(() => { unmount() })
  })
})
