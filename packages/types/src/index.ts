// ─────────────────────────────────────────────────────────────────
// @sdf/types — ISA-95 데이터 모델 및 플랫폼 공통 TypeScript 타입
// ─────────────────────────────────────────────────────────────────

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

export type MachineStatus = "normal" | "degraded" | "fault" | "offline"
export type RobotStatus = "idle" | "moving" | "dispatched" | "arrived"
export type AgentId = "A" | "B" | "C"
export type AgentStatus = "running" | "complete" | "error"

export interface MachineState {
  vibration: number
  temperature: number
  current: number
  status: MachineStatus
  history: [number, number, number, number][]
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

// ─── Placement system ───────────────────────────────────────────
export type MachineType = "press" | "cnc" | "conveyor"
export type EntityType = MachineType | "robot" | "custom"

export interface PlacedEntity {
  id: string
  type: EntityType
  x: number
  z: number
  label: string
  /** custom 타입일 때 외부 GLB/GLTF 모델 URL 또는 ObjectURL */
  modelUrl?: string
}

export interface PaletteItem {
  poolId: string
  type: EntityType
  label: string
  isPlaced: boolean
}

// ─── Detail data ────────────────────────────────────────────────
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

// ─── Dashboard & Plugin Metadata Schema ─────────────────────────

export interface CameraState {
  position: [number, number, number]
  target: [number, number, number]
}

export type SensorKey = "vibration" | "temperature" | "current"

export interface ChartSeriesConfig {
  key: SensorKey
  color: string
}

export type ChartType = "line" | "bar" | "area"

export interface ChartConfig {
  chartType: ChartType
  series: ChartSeriesConfig[]
}

export interface SimParamsForSensor {
  min: number
  avg: number
  max: number
}

export interface SimParams {
  vibration: SimParamsForSensor
  temperature: SimParamsForSensor
  current: SimParamsForSensor
  faultIntervalSec: number
}

export interface EntityConfig {
  entityId: string
  displayName: string
  meta: Record<string, string | number | boolean>
  chart: ChartConfig
  simParams: SimParams
}

export interface DashboardConfig {
  version: number
  camera: CameraState
  entities: Record<string, EntityConfig>
  simTimeScale: SimTimeScale
  gaussianNoiseFactor: number
}

export type SimTimeScale = 1 | 2 | 5

// ─── MES (Manufacturing Execution System) — ISA-95 ──────────────

export type WorkOrderPriority = "S" | "A" | "B"

export interface WorkOrder {
  id: string
  materialName: string
  priority: WorkOrderPriority
  targetQuantity: number
  currentQuantity: number
  dueDate: string
}

// ─── 3D Authoring & Layout ──────────────────────────────────────

export interface EntityScale {
  x: number
  y: number
  z: number
}

export type LayoutPanelId = string

export interface LayoutPanel {
  id: LayoutPanelId
  label: string
  /** 그리드 X 좌표 (0-based) */
  x: number
  /** 그리드 Y 좌표 (0-based) */
  y: number
  /** 그리드 폭 (컬럼 수) */
  w: number
  /** 그리드 높이 (행 수) */
  h: number
  visible: boolean
}

export interface LayoutConfig {
  /** DashboardConfig 버전 (v2 = react-grid-layout) */
  version: 2
  /** 그리드 컬럼 수 */
  columns: number
  panels: LayoutPanel[]
}

// ─── Data Transformation — Computed Metrics ─────────────────────

export interface ComputedMetric {
  id: string
  name: string
  formula: string
  color: string
  machineId: string | null
}

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

// ─── Dynamic Rule Engine ────────────────────────────────────────

export type RuleVariable =
  | "vibration" | "temperature" | "current"
  | string

export type RuleActionType = "overlay_color" | "alert_popup" | "play_sound" | "webhook_post"

export interface RuleAction {
  type: RuleActionType
  color?: string
  webhookUrl?: string
  webhookChannel?: "slack" | "discord"
  soundFrequency?: number
}

export interface Rule {
  id: string
  name: string
  condition: string
  machineId: string | null
  actions: RuleAction[]
  lastTriggeredAt: number
  cooldownMs: number
  enabled: boolean
}

// ─── MES Closed-Loop Rerouting ──────────────────────────────────

export type ReroutingStatus = "rerouting" | "completed" | "failed"

export interface ReroutingEvent {
  id: string
  ts: number
  fromMachineId: string
  toMachineId: string
  workOrder: WorkOrder
  status: ReroutingStatus
}

// ─── Plugin SDK ─────────────────────────────────────────────────

export interface SDFPlugin {
  id: string
  name: string
  version: string
  description?: string
  activate: (ctx: PluginContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}

export interface PluginContext {
  store: {
    getState: () => unknown
    subscribe: (listener: (state: unknown) => void) => () => void
  }
  registerPanel: (panel: PluginPanel) => void
  registerRule: (rule: Omit<Rule, "id" | "lastTriggeredAt">) => void
  registerMetric: (metric: Omit<ComputedMetric, "id">) => void
}

export interface PluginPanel {
  id: string
  label: string
  component: (props: PluginProps) => unknown
  defaultPosition?: { x: number; y: number; w: number; h: number }
}

export interface PluginProps {
  /**
   * Subscribes to a slice of the host store via a selector. The component
   * only re-renders when the selected value actually changes (compared with
   * deep equality, since the host store clones its full state on every
   * update, so reference equality would never bypass a re-render), not on
   * every host store update. `state` is typed `unknown` — plugin-runtime has
   * no dependency on the host app's concrete store shape, so plugin authors
   * cast to whatever shape they know at the call site.
   */
  useStoreSlice: <T>(selector: (state: unknown) => T) => T
}
