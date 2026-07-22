import { describe, it, expect, vi } from "vitest"
import { createHostBindings } from "@/lib/pluginBootstrap"
import { useFactoryStore } from "@/store/factoryStore"

describe("createHostBindings", () => {
  it("getReadOnlyState strips function-typed values from the store snapshot", () => {
    const bindings = createHostBindings()
    const state = bindings.getReadOnlyState() as Record<string, unknown>
    for (const value of Object.values(state)) {
      expect(typeof value).not.toBe("function")
    }
  })

  it("subscribe hands listeners a stripped snapshot, never the raw store with its actions", () => {
    const bindings = createHostBindings()
    const listener = vi.fn()

    const unsubscribe = bindings.subscribe(listener)
    // Trigger a change so the wrapped listener fires.
    useFactoryStore.getState().addRule({
      name: "test rule",
      condition: "temperature > 90",
      machineId: null,
      actions: [{ type: "alert_popup" }],
      cooldownMs: 5000,
      enabled: true,
    })
    unsubscribe()

    expect(listener).toHaveBeenCalled()
    const receivedState = listener.mock.calls[0][0] as Record<string, unknown>
    for (const value of Object.values(receivedState)) {
      expect(typeof value).not.toBe("function")
    }
    // Sanity check: raw store state does contain functions (e.g. addRule), so this
    // assertion would fail against the unfixed binding — proving stripFunctions ran.
    expect(receivedState).not.toHaveProperty("addRule")
    expect(receivedState).not.toHaveProperty("removeEntity")
    expect(receivedState).not.toHaveProperty("setDashboardConfig")
    expect(receivedState).not.toHaveProperty("importConfig")
  })
})
