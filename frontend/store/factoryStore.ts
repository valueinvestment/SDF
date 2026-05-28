import { create } from "zustand"
import type {
  MachineState, RobotState, AgentEvent, Alert, DispatchCommand,
  SensorSnapshot, PlacedEntity, EntityType, MachineDetail,
  RobotPathDetail, ComponentFaultMap,
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
  placementMode: { type: EntityType; poolId: string } | null
  enterPlacementMode: (type: EntityType, poolId: string) => void
  exitPlacementMode: () => void
  placeEntity: (poolId: string, type: EntityType, x: number, z: number) => void
  removeEntity: (poolId: string) => void

  selectedEntityId: string | null
  selectEntity: (id: string | null) => void

  machineDetails: Record<string, MachineDetail>
  robotPaths: Record<string, RobotPathDetail>
  componentFaults: Record<string, ComponentFaultMap>
  setMachineDetail: (detail: MachineDetail) => void
  setRobotPath: (path: RobotPathDetail) => void
  setComponentFault: (fault: ComponentFaultMap) => void
}

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  machines: {},
  robots: {},
  agentEvents: [],
  activeAlert: null,
  dispatchCommand: null,

  applySnapshot: (snapshot) => {
    set((state) => {
      const machines = { ...state.machines }
      for (const [id, data] of Object.entries(snapshot.machines)) {
        const prev = machines[id]
        const history: [number, number][] = prev ? [...prev.history] : []
        history.push([snapshot.ts, data.vibration])
        if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
        machines[id] = { ...data, history }
      }
      return { machines, robots: { ...state.robots, ...snapshot.robots } }
    })
  },

  addAgentEvent: (event) =>
    set((state) => ({ agentEvents: [...state.agentEvents, event] })),
  setActiveAlert: (alert) => set({ activeAlert: alert }),
  setDispatchCommand: (cmd) => set({ dispatchCommand: cmd }),

  placedEntities: [],
  placementMode: null,
  enterPlacementMode: (type, poolId) => set({ placementMode: { type, poolId } }),
  exitPlacementMode: () => set({ placementMode: null }),
  placeEntity: (poolId, type, x, z) =>
    set((state) => {
      if (state.placedEntities.some((e) => e.id === poolId)) return {}
      return {
        placedEntities: [...state.placedEntities, { id: poolId, type, x, z, label: poolId }],
        placementMode: null,
      }
    }),
  removeEntity: (poolId) =>
    set((state) => ({
      placedEntities: state.placedEntities.filter((e) => e.id !== poolId),
    })),

  selectedEntityId: null,
  selectEntity: (id) => set({ selectedEntityId: id }),

  machineDetails: {},
  robotPaths: {},
  componentFaults: {},
  setMachineDetail: (detail) =>
    set((state) => ({ machineDetails: { ...state.machineDetails, [detail.machineId]: detail } })),
  setRobotPath: (path) =>
    set((state) => ({ robotPaths: { ...state.robotPaths, [path.robotId]: path } })),
  setComponentFault: (fault) =>
    set((state) => ({ componentFaults: { ...state.componentFaults, [fault.machineId]: fault } })),
}))
