import { create } from "zustand"
import type {
  MachineState, RobotState, AgentEvent, Alert, DispatchCommand,
  SensorSnapshot, PlacedEntity, EntityType, MachineDetail,
  RobotPathDetail, ComponentFaultMap, Toast, AlertHistoryItem,
} from "@/lib/types"

const HISTORY_MAX = 300

interface FactoryStore {
  machines: Record<string, MachineState>
  robots: Record<string, RobotState>
  agentEvents: AgentEvent[]
  activeAlert: Alert | null
  dispatchCommand: DispatchCommand | null
  applySnapshot: (snapshot: SensorSnapshot) => void
  addAgentEvent: (event: AgentEvent) => void
  setActiveAlert: (alert: Alert | null) => void
  setDispatchCommand: (cmd: DispatchCommand | null) => void

  placedEntities: PlacedEntity[]
  placementMode: { type: EntityType; poolId: string; label: string } | null
  enterPlacementMode: (type: EntityType, poolId: string, label: string) => void
  exitPlacementMode: () => void
  placeEntity: (poolId: string, type: EntityType, x: number, z: number, label?: string) => void
  removeEntity: (poolId: string) => void
  moveEntity: (poolId: string) => void

  selectedEntityId: string | null
  selectEntity: (id: string | null) => void

  machineDetails: Record<string, MachineDetail>
  robotPaths: Record<string, RobotPathDetail>
  componentFaults: Record<string, ComponentFaultMap>
  setMachineDetail: (detail: MachineDetail) => void
  setRobotPath: (path: RobotPathDetail) => void
  setComponentFault: (fault: ComponentFaultMap) => void

  toasts: Toast[]
  alertHistory: AlertHistoryItem[]
  addToast: (toast: Omit<Toast, "id">) => void
  dismissToast: (id: string) => void
}

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  machines: {},
  robots: {},
  agentEvents: [],
  activeAlert: null,
  dispatchCommand: null,

  applySnapshot: (snapshot) => {
    if (!snapshot?.machines) return
    set((state) => {
      const machines = { ...state.machines }
      for (const [id, data] of Object.entries(snapshot.machines)) {
        const prev = machines[id]
        const history: [number, number, number, number][] = prev ? [...prev.history] : []
        history.push([
          snapshot.ts,
          data.vibration ?? 0,
          data.temperature ?? 0,
          data.current ?? 0,
        ])
        if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
        machines[id] = { ...data, history }
      }
      return { machines, robots: snapshot.robots ? { ...state.robots, ...snapshot.robots } : state.robots }
    })
  },

  addAgentEvent: (event) => {
    set((state) => ({ agentEvents: [...state.agentEvents, event] }))
    if (event.agentId === "C" && (event.status === "complete" || event.status === "error")) {
      const type = event.status === "complete" ? "success" : "error"
      const title = event.status === "complete" ? "처리 완료" : "처리 오류"
      get().addToast({ type, title, body: event.summary || "-" })
      set((state) => {
        if (!state.alertHistory.length) return {}
        const history = [...state.alertHistory]
        if (!history[0].result) history[0] = { ...history[0], result: event.summary || "-" }
        return { alertHistory: history }
      })
    }
  },
  setActiveAlert: (alert) => {
    if (alert) {
      const id = `alert-${alert.ts}`
      set((state) => ({
        activeAlert: alert,
        alertHistory: [{ id, machineId: alert.machineId, ts: alert.ts }, ...state.alertHistory],
      }))
      get().addToast({ type: "warning", title: "이상 감지", body: `기계 ${alert.machineId}에서 이상이 감지되었습니다` })
    } else {
      set({ activeAlert: null })
    }
  },
  setDispatchCommand: (cmd) => set({ dispatchCommand: cmd }),

  placedEntities: [
    { id: "M1", type: "press",    x: 3,  z: 3,  label: "프레스" },
    { id: "M2", type: "cnc",      x: 7,  z: 3,  label: "CNC" },
    { id: "M3", type: "cnc",      x: 12, z: 3,  label: "CNC #2" },
    { id: "M4", type: "conveyor", x: 3,  z: 12, label: "컨베이어" },
    { id: "M5", type: "press",    x: 12, z: 12, label: "프레스 #2" },
    { id: "R1", type: "robot",    x: 10, z: 10, label: "AMR #1" },
    { id: "R2", type: "robot",    x: 5,  z: 5,  label: "AMR #2" },
    { id: "R3", type: "robot",    x: 15, z: 5,  label: "AMR #3" },
  ] as PlacedEntity[],
  placementMode: null,
  enterPlacementMode: (type, poolId, label) => set({ placementMode: { type, poolId, label } }),
  exitPlacementMode: () => set({ placementMode: null }),
  placeEntity: (poolId, type, x, z, label) =>
    set((state) => {
      if (state.placedEntities.some((e) => e.id === poolId)) return {}
      return {
        placedEntities: [...state.placedEntities, { id: poolId, type, x, z, label: label ?? poolId }],
        placementMode: null,
      }
    }),
  removeEntity: (poolId) =>
    set((state) => ({
      placedEntities: state.placedEntities.filter((e) => e.id !== poolId),
    })),
  moveEntity: (poolId) =>
    set((state) => {
      const entity = state.placedEntities.find((e) => e.id === poolId)
      if (!entity) return {}
      return {
        placedEntities: state.placedEntities.filter((e) => e.id !== poolId),
        placementMode: { type: entity.type, poolId, label: entity.label },
      }
    }),

  selectedEntityId: null,
  selectEntity: (id) => set({ selectedEntityId: id }),

  machineDetails: {},
  robotPaths: {},
  componentFaults: {},
  toasts: [],
  alertHistory: [],
  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random()}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    setTimeout(() => get().dismissToast(id), 6000)
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  setMachineDetail: (detail) =>
    set((state) => ({ machineDetails: { ...state.machineDetails, [detail.machineId]: detail } })),
  setRobotPath: (path) =>
    set((state) => ({ robotPaths: { ...state.robotPaths, [path.robotId]: path } })),
  setComponentFault: (fault) =>
    set((state) => ({ componentFaults: { ...state.componentFaults, [fault.machineId]: fault } })),
}))
