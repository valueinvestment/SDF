import { create } from "zustand"
import type { MachineState, RobotState, AgentEvent, Alert, DispatchCommand, SensorSnapshot } from "@/lib/types"

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

  addAgentEvent: (event) => {
    set((state) => ({ agentEvents: [...state.agentEvents, event] }))
  },

  setActiveAlert: (alert) => set({ activeAlert: alert }),
  setDispatchCommand: (cmd) => set({ dispatchCommand: cmd }),
}))
