import { describe, it, expect, beforeEach } from "vitest"
import { useFactoryStore } from "@/store/factoryStore"

beforeEach(() => {
  useFactoryStore.setState({
    machines: {},
    robots: {},
    agentEvents: [],
    activeAlert: null,
    dispatchCommand: null,
  })
})

describe("applySnapshot", () => {
  it("adds machines from snapshot", () => {
    useFactoryStore.getState().applySnapshot({
      ts: 1000,
      machines: {
        M1: { vibration: 50, temperature: 70, current: 15, status: "normal" },
      },
      robots: {},
    })
    const { machines } = useFactoryStore.getState()
    expect(machines["M1"].status).toBe("normal")
  })

  it("appends vibration to history ring buffer capped at 300", () => {
    const store = useFactoryStore.getState()
    for (let i = 0; i < 350; i++) {
      store.applySnapshot({
        ts: i * 100,
        machines: { M1: { vibration: i, temperature: 70, current: 15, status: "normal" } },
        robots: {},
      })
    }
    expect(useFactoryStore.getState().machines["M1"].history.length).toBe(300)
  })
})

describe("addAgentEvent", () => {
  it("appends to agentEvents", () => {
    useFactoryStore.getState().addAgentEvent({
      agentId: "A",
      status: "complete",
      summary: "test",
      ts: 1000,
    })
    expect(useFactoryStore.getState().agentEvents).toHaveLength(1)
  })
})
