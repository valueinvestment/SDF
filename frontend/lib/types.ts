export type MachineStatus = "normal" | "degraded" | "fault"
export type RobotStatus = "idle" | "moving" | "dispatched" | "arrived"
export type AgentId = "A" | "B" | "C"
export type AgentStatus = "running" | "complete" | "error"

export interface MachineState {
  vibration: number
  temperature: number
  current: number
  status: MachineStatus
  history: [number, number][]   // [ts, vibration] ring buffer, max 300 points
}

export interface RobotState {
  x: number
  y: number
  heading: number
  status: RobotStatus
}

export interface AgentEvent {
  agentId: AgentId
  status: AgentStatus
  summary: string
  ts: number
}

export interface DispatchCommand {
  robotId: string
  targetMachineId: string
  path: [number, number][]
  estimatedArrival: number
}

export interface Alert {
  machineId: string
  ts: number
}

export interface SensorSnapshot {
  ts: number
  machines: Record<string, Omit<MachineState, "history">>
  robots: Record<string, RobotState>
}

export type WSMessage =
  | { type: "sensor_update"; payload: SensorSnapshot }
  | { type: "robot_dispatch"; payload: DispatchCommand }
  | { type: "agent_event"; payload: AgentEvent }
  | { type: "alert"; payload: Alert }
