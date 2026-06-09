export interface Toast {
  id: string
  type: "warning" | "success" | "error"
  title: string
  body: string
}

export interface AlertHistoryItem {
  id: string
  machineId: string
  ts: number
  result?: string
}

export type MachineStatus = "normal" | "degraded" | "fault"
export type RobotStatus = "idle" | "moving" | "dispatched" | "arrived"
export type AgentId = "A" | "B" | "C"
export type AgentStatus = "running" | "complete" | "error"

export interface MachineState {
  vibration: number
  temperature: number
  current: number
  status: MachineStatus
  history: [number, number, number, number][]  // [ts, vibration, temperature, current]
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

// Placement system
export type MachineType = "press" | "cnc" | "conveyor"
export type EntityType = MachineType | "robot"

export interface PlacedEntity {
  id: string
  type: EntityType
  x: number
  z: number
  label: string
}

export interface PaletteItem {
  poolId: string
  type: EntityType
  label: string
  isPlaced: boolean
}

// Detail data
export interface ComponentStatus {
  wear: number
  temperature: number
  status: "ok" | "warn" | "critical"
}

export interface MachineDetail {
  machineId: string
  ts: number
  operationRate: number
  components: Record<string, ComponentStatus>
  thermalGrid: number[][]
}

export interface RobotPathDetail {
  robotId: string
  currentPos: [number, number]
  recommendedPath: [number, number][]
  targetEntityId: string | null
  eta: number
  pathType: "idle_patrol" | "dispatch" | "returning"
}

export interface ComponentFaultMap {
  machineId: string
  faultedParts: Record<string, {
    severity: "warn" | "critical"
    description: string
  }>
}

export type WSMessage =
  | { type: "sensor_update";    payload: SensorSnapshot }
  | { type: "robot_dispatch";   payload: DispatchCommand }
  | { type: "agent_event";      payload: AgentEvent }
  | { type: "alert";            payload: Alert }
  | { type: "machine_detail";   payload: MachineDetail }
  | { type: "robot_path";       payload: RobotPathDetail }
  | { type: "component_fault";  payload: ComponentFaultMap }
