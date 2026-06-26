import { describe, it, expect, beforeEach } from "vitest"
import { useFactoryStore } from "@/store/factoryStore"

beforeEach(() => {
  useFactoryStore.setState({
    machines: {},
    robots: {},
    agentEvents: [],
    activeAlert: null,
    dispatchCommand: null,
    placedEntities: [],
    placementMode: null,
    selectedEntityId: null,
    machineDetails: {},
    robotPaths: {},
    componentFaults: {},
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

describe("placement", () => {
  it("places an entity", () => {
    useFactoryStore.getState().placeEntity("M1", "press", 5, 3)
    const { placedEntities } = useFactoryStore.getState()
    expect(placedEntities).toHaveLength(1)
    expect(placedEntities[0].id).toBe("M1")
  })

  it("prevents duplicate placement", () => {
    useFactoryStore.getState().placeEntity("M1", "press", 5, 3)
    useFactoryStore.getState().placeEntity("M1", "press", 7, 7)
    expect(useFactoryStore.getState().placedEntities).toHaveLength(1)
  })

  it("removes an entity", () => {
    useFactoryStore.getState().placeEntity("M2", "cnc", 5, 5)
    useFactoryStore.getState().removeEntity("M2")
    expect(useFactoryStore.getState().placedEntities).toHaveLength(0)
  })
})

describe("selection", () => {
  it("sets selectedEntityId", () => {
    useFactoryStore.getState().selectEntity("M3")
    expect(useFactoryStore.getState().selectedEntityId).toBe("M3")
  })

  it("clears selection", () => {
    useFactoryStore.getState().selectEntity("M3")
    useFactoryStore.getState().selectEntity(null)
    expect(useFactoryStore.getState().selectedEntityId).toBeNull()
  })
})

describe("custom GLB/GLTF entity placement", () => {
  it("persists modelUrl from placementMode onto the placed entity", () => {
    const url = "blob:http://localhost/abc-123"
    useFactoryStore.getState().enterPlacementMode("custom", "custom-1", "Custom #1", url)
    useFactoryStore.getState().placeEntity("custom-1", "custom", 4, 4, "Custom #1")

    const entity = useFactoryStore.getState().placedEntities.find((e) => e.id === "custom-1")
    expect(entity?.type).toBe("custom")
    expect(entity?.modelUrl).toBe(url)
  })

  it("does not create a WorkOrder for custom entities (non-machine)", () => {
    useFactoryStore.getState().enterPlacementMode("custom", "custom-2", "Custom #2", "http://x/m.glb")
    useFactoryStore.getState().placeEntity("custom-2", "custom", 6, 6, "Custom #2")
    expect(useFactoryStore.getState().workOrders["custom-2"]).toBeUndefined()
  })

  it("omits modelUrl for standard machine entities", () => {
    useFactoryStore.getState().placeEntity("M9", "press", 2, 2)
    const entity = useFactoryStore.getState().placedEntities.find((e) => e.id === "M9")
    expect(entity?.modelUrl).toBeUndefined()
  })
})

describe("layout v1 → v2 migration on import", () => {
  it("resets a legacy (col/row) layout to the v2 default", () => {
    const legacyConfig = JSON.stringify({
      layoutConfig: {
        columns: 3,
        panels: [{ id: "canvas", label: "3D", col: "1 / 3", row: "1 / 2", visible: true }],
      },
    })
    useFactoryStore.getState().importConfig(legacyConfig)
    const lc = useFactoryStore.getState().layoutConfig
    expect(lc.version).toBe(2)
    // 좌표 기반 패널로 초기화되었는지 확인
    expect(lc.panels.every((p) => typeof p.x === "number" && typeof p.w === "number")).toBe(true)
  })

  it("preserves a v2 layout as-is", () => {
    const v2Config = JSON.stringify({
      layoutConfig: {
        version: 2,
        columns: 4,
        panels: [{ id: "canvas", label: "3D", x: 0, y: 0, w: 2, h: 3, visible: true }],
      },
    })
    useFactoryStore.getState().importConfig(v2Config)
    const lc = useFactoryStore.getState().layoutConfig
    expect(lc.version).toBe(2)
    expect(lc.columns).toBe(4)
    expect(lc.panels[0].w).toBe(2)
  })
})

describe("MES closed-loop rerouting", () => {
  beforeEach(() => {
    useFactoryStore.setState({
      placedEntities: [
        { id: "P1", type: "press", x: 3, z: 3, label: "프레스1" },
        { id: "P2", type: "press", x: 7, z: 3, label: "프레스2" },
      ],
      reroutingLog: [],
    })
    useFactoryStore.getState().initWorkOrders()
  })

  it("transfers a work order to a same-type sibling machine", () => {
    const before = useFactoryStore.getState().workOrders["P1"]
    expect(before).toBeDefined()

    useFactoryStore.getState().rerouteWorkOrder("P1")

    const log = useFactoryStore.getState().reroutingLog
    expect(log.length).toBe(1)
    expect(log[0].fromMachineId).toBe("P1")
    expect(log[0].toMachineId).toBe("P2")
    expect(log[0].status).toBe("rerouting")
  })

  it("does nothing when no same-type candidate exists", () => {
    useFactoryStore.setState({
      placedEntities: [{ id: "ONLY", type: "cnc", x: 3, z: 3, label: "유일 CNC" }],
    })
    useFactoryStore.getState().initWorkOrders()
    useFactoryStore.getState().rerouteWorkOrder("ONLY")
    expect(useFactoryStore.getState().reroutingLog.length).toBe(0)
  })
})

describe("rule engine cooldown", () => {
  it("records lastTriggeredAt via touchRuleTrigger", () => {
    useFactoryStore.getState().addRule({
      name: "과열 경보",
      condition: "temperature > 100",
      machineId: null,
      actions: [{ type: "overlay_color", color: "#ef4444" }],
      cooldownMs: 5000,
      enabled: true,
    })
    const rule = useFactoryStore.getState().rules[0]
    expect(rule.lastTriggeredAt).toBe(0)

    useFactoryStore.getState().touchRuleTrigger(rule.id, 123456)
    expect(useFactoryStore.getState().rules[0].lastTriggeredAt).toBe(123456)
  })
})
