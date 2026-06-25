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

// ─────────────────────────────────────────────────────────────────
// Dashboard & Plugin Metadata Schema (1단계 코어 개편)
// ─────────────────────────────────────────────────────────────────

/** Three.js 카메라 스냅샷 (position / target 벡터) */
export interface CameraState {
  position: [number, number, number]
  target: [number, number, number]
}

/** 차트 설정: 어떤 데이터를 어떤 색상으로 보여줄지 */
export type SensorKey = "vibration" | "temperature" | "current"

export interface ChartSeriesConfig {
  key: SensorKey
  color: string  // hex e.g. "#3b82f6"
}

export type ChartType = "line" | "bar" | "area"

export interface ChartConfig {
  chartType: ChartType
  series: ChartSeriesConfig[]
}

/** 시뮬레이션 파라미터 (기계/센서별 커스텀 노이즈 범위) */
export interface SimParamsForSensor {
  min: number
  avg: number
  max: number
}

export interface SimParams {
  vibration: SimParamsForSensor
  temperature: SimParamsForSensor
  current: SimParamsForSensor
  /** 고장 평균 간격(초 기준, 시뮬레이션 배속 적용 전) */
  faultIntervalSec: number
}

/** 엔티티(기계 or 로봇) 별 커스텀 메타 및 표시 설정 */
export interface EntityConfig {
  /** PlacedEntity.id 와 동일 */
  entityId: string
  /** UI 표시 이름 (기본값: label) */
  displayName: string
  /** 사용자 정의 속성 (자유 형식) */
  meta: Record<string, string | number | boolean>
  chart: ChartConfig
  simParams: SimParams
}

/** 전체 대시보드 레이아웃 & 플러그인 설정 */
export interface DashboardConfig {
  version: number
  /** Three.js OrbitControls 캡처 카메라 상태 */
  camera: CameraState
  /** 엔티티별 커스텀 설정 맵 (entityId → EntityConfig) */
  entities: Record<string, EntityConfig>
  /** 시뮬레이터 전역 배속 (1 | 2 | 5) */
  simTimeScale: SimTimeScale
  /** 가우시안 노이즈 분산 계수 (0 = 노이즈 없음, 1 = 최대) */
  gaussianNoiseFactor: number
}

/** 시뮬레이션 배속 */
export type SimTimeScale = 1 | 2 | 5

// ─────────────────────────────────────────────────────────────────
// MES (제조실행시스템) 스키마 — ISA-95 참조
// ─────────────────────────────────────────────────────────────────

export type WorkOrderPriority = "S" | "A" | "B"

export interface WorkOrder {
  id: string
  materialName: string
  priority: WorkOrderPriority
  targetQuantity: number
  currentQuantity: number
  dueDate: string  // ISO 8601 date string
}

// ─────────────────────────────────────────────────────────────────
// 3단계: 3D 저작 + 자유 레이아웃
// ─────────────────────────────────────────────────────────────────

/** 기계/로봇 개별 스케일 팩터 (X/Y/Z 독립 배율) */
export interface EntityScale {
  x: number
  y: number
  z: number
}

/** 레이아웃 패널 식별자 */
export type LayoutPanelId = "canvas" | "charts" | "agent" | "detail" | "rules" | "mes"

/** react-grid-layout 좌표 기반 패널 배치 */
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

/** 전체 레이아웃 설정 */
export interface LayoutConfig {
  /** DashboardConfig 버전 (v2 = react-grid-layout) */
  version: 2
  /** 그리드 컬럼 수 */
  columns: number
  panels: LayoutPanel[]
}

// ─────────────────────────────────────────────────────────────────
// 2단계: 데이터 변환 레이어 — 커스텀 계산 지표
// ─────────────────────────────────────────────────────────────────

/** 사용자가 정의한 수식 기반 커스텀 지표 */
export interface ComputedMetric {
  id: string
  /** 표시 이름 (차트 범례 등) */
  name: string
  /** 수식 문자열 e.g. "(vibration + temperature) / 2" */
  formula: string
  /** 차트 시리즈 색상 */
  color: string
  /** 바인딩된 machineId (null이면 전체 미적용) */
  machineId: string | null
}

/** 수식 평가 결과 */
export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

// ─────────────────────────────────────────────────────────────────
// 2단계: 동적 룰 엔진 타입
// ─────────────────────────────────────────────────────────────────

/** 룰에서 참조 가능한 변수 */
export type RuleVariable =
  | "vibration" | "temperature" | "current"
  | string // 커스텀 지표 id도 허용

/** 룰이 트리거될 때 실행할 헤드리스 액션 */
export type RuleActionType = "overlay_color" | "alert_popup" | "play_sound" | "webhook_post"

export interface RuleAction {
  type: RuleActionType
  /** overlay_color: hex 색상 e.g. "#ef4444" */
  color?: string
  /** webhook_post: URL */
  webhookUrl?: string
  /** webhook_post: 채널 식별자 */
  webhookChannel?: "slack" | "discord"
  /** play_sound: 주파수(Hz), 0이면 기본 경고음 */
  soundFrequency?: number
}

export interface Rule {
  id: string
  name: string
  /** 조건 수식 e.g. "temperature > 100" */
  condition: string
  /** 이 룰을 적용할 machineId (null이면 전체 기계) */
  machineId: string | null
  /** 트리거 시 실행할 액션 목록 */
  actions: RuleAction[]
  /** 연속 트리거 방지: 마지막 트리거 ts */
  lastTriggeredAt: number
  /** 재트리거 최소 간격(ms) */
  cooldownMs: number
  enabled: boolean
}

// ─────────────────────────────────────────────────────────────────
// 4단계: MES 폐루프 이관 이벤트
// ─────────────────────────────────────────────────────────────────

export type ReroutingStatus = "rerouting" | "completed" | "failed"

export interface ReroutingEvent {
  id: string
  ts: number
  /** 결함 감지된 원본 기계 */
  fromMachineId: string
  /** 이관 대상 기계 */
  toMachineId: string
  /** 이관된 WorkOrder */
  workOrder: WorkOrder
  status: ReroutingStatus
}
