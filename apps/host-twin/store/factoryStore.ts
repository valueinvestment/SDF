import { create } from "zustand"
import type {
  MachineState, RobotState, AgentEvent, Alert, DispatchCommand,
  SensorSnapshot, PlacedEntity, EntityType, MachineDetail,
  RobotPathDetail, ComponentFaultMap, Toast, AlertHistoryItem,
  DashboardConfig, EntityConfig, SimTimeScale, WorkOrder, CameraState,
  ComputedMetric, Rule, RuleAction, ReroutingEvent,
  EntityScale, LayoutConfig, LayoutPanel, LayoutPanelId,
} from "@sdf/types"

const HISTORY_MAX = 300

// ─── 기본 시뮬레이션 파라미터 ───────────────────────────────────────
function makeDefaultEntityConfig(entityId: string, displayName: string): EntityConfig {
  return {
    entityId,
    displayName,
    meta: {},
    chart: {
      chartType: "line",
      series: [
        { key: "vibration",   color: "#3b82f6" },
        { key: "temperature", color: "#f97316" },
        { key: "current",     color: "#a855f7" },
      ],
    },
    simParams: {
      vibration:   { min: 0.5,  avg: 2.0,  max: 4.0  },
      temperature: { min: 45,   avg: 65,   max: 90   },
      current:     { min: 5,    avg: 12,   max: 20   },
      faultIntervalSec: 120,
    },
  }
}

function makeDefaultDashboardConfig(entities: PlacedEntity[]): DashboardConfig {
  const entityMap: Record<string, EntityConfig> = {}
  for (const e of entities) {
    entityMap[e.id] = makeDefaultEntityConfig(e.id, e.label)
  }
  return {
    version: 1,
    camera: { position: [10, 20, 20], target: [10, 0, 10] },
    entities: entityMap,
    simTimeScale: 1,
    gaussianNoiseFactor: 0.3,
  }
}

// ─── 기본 WorkOrder 큐 생성 ──────────────────────────────────────────
let woSeq = 1
function makeWorkOrder(): WorkOrder {
  const priorities: WorkOrder["priority"][] = ["S", "A", "B"]
  const materials = ["SUS304", "AL6061", "티타늄합금", "탄소강", "구리합금"]
  const now = new Date()
  now.setDate(now.getDate() + Math.floor(Math.random() * 7) + 1)
  return {
    id: `WO-${String(woSeq++).padStart(4, "0")}`,
    materialName: materials[Math.floor(Math.random() * materials.length)],
    priority: priorities[Math.floor(Math.random() * priorities.length)],
    targetQuantity: 50 + Math.floor(Math.random() * 200),
    currentQuantity: 0,
    dueDate: now.toISOString().split("T")[0],
  }
}

// ─── 기본 레이아웃 설정 (v2: react-grid-layout 좌표) ─────────────────
const DEFAULT_LAYOUT: LayoutConfig = {
  version: 2,
  columns: 3,
  panels: [
    { id: "canvas",  label: "3D 캔버스",    x: 0, y: 0, w: 2, h: 4, visible: true },
    { id: "agent",   label: "에이전트 패널", x: 2, y: 0, w: 1, h: 4, visible: true },
    { id: "charts",  label: "센서 차트",    x: 0, y: 4, w: 1, h: 3, visible: true },
    { id: "detail",  label: "상세 패널",    x: 1, y: 4, w: 1, h: 3, visible: true },
    { id: "rules",   label: "룰 엔진",      x: 2, y: 4, w: 1, h: 3, visible: true },
    { id: "mes",     label: "MES 모니터",   x: 0, y: 7, w: 3, h: 2, visible: true },
  ],
}

const DEFAULT_PLACED_ENTITIES: PlacedEntity[] = [
  { id: "M1", type: "press",    x: 3,  z: 3,  label: "프레스" },
  { id: "M2", type: "cnc",      x: 7,  z: 3,  label: "CNC" },
  { id: "M3", type: "cnc",      x: 12, z: 3,  label: "CNC #2" },
  { id: "M4", type: "conveyor", x: 3,  z: 12, label: "컨베이어" },
  { id: "M5", type: "press",    x: 12, z: 12, label: "프레스 #2" },
  { id: "R1", type: "robot",    x: 10, z: 10, label: "AMR #1" },
  { id: "R2", type: "robot",    x: 5,  z: 5,  label: "AMR #2" },
  { id: "R3", type: "robot",    x: 15, z: 5,  label: "AMR #3" },
]

// ─── 스토어 인터페이스 ────────────────────────────────────────────────
interface FactoryStore {
  // 기존 실시간 데이터
  machines: Record<string, MachineState>
  robots: Record<string, RobotState>
  agentEvents: AgentEvent[]
  activeAlert: Alert | null
  dispatchCommand: DispatchCommand | null
  applySnapshot: (snapshot: SensorSnapshot) => void
  addAgentEvent: (event: AgentEvent) => void
  setActiveAlert: (alert: Alert | null) => void
  setDispatchCommand: (cmd: DispatchCommand | null) => void

  // 배치 시스템
  placedEntities: PlacedEntity[]
  placementMode: { type: EntityType; poolId: string; label: string; modelUrl?: string } | null
  enterPlacementMode: (type: EntityType, poolId: string, label: string, modelUrl?: string) => void
  exitPlacementMode: () => void
  placeEntity: (poolId: string, type: EntityType, x: number, z: number, label?: string) => void
  removeEntity: (poolId: string) => void
  moveEntity: (poolId: string) => void

  // 선택
  selectedEntityId: string | null
  selectEntity: (id: string | null) => void

  // 상세 데이터
  machineDetails: Record<string, MachineDetail>
  robotPaths: Record<string, RobotPathDetail>
  componentFaults: Record<string, ComponentFaultMap>
  setMachineDetail: (detail: MachineDetail) => void
  setRobotPath: (path: RobotPathDetail) => void
  setComponentFault: (fault: ComponentFaultMap) => void

  // 알림
  toasts: Toast[]
  alertHistory: AlertHistoryItem[]
  addToast: (toast: Omit<Toast, "id">) => void
  dismissToast: (id: string) => void

  // ─── 신규: 대시보드 설정 ─────────────────────────────────────────
  dashboardConfig: DashboardConfig
  setDashboardConfig: (config: DashboardConfig) => void
  updateEntityConfig: (entityId: string, patch: Partial<EntityConfig>) => void
  setSimTimeScale: (scale: SimTimeScale) => void
  setGaussianNoiseFactor: (factor: number) => void
  /** Three.js OrbitControls에서 카메라 상태 캡처 후 저장 */
  captureCamera: (camera: CameraState) => void

  // ─── 신규: MES WorkOrder ─────────────────────────────────────────
  /** 기계 ID별 현재 작업 지시서 */
  workOrders: Record<string, WorkOrder>
  /** 기계 ID별 대기 큐 (최대 3개) */
  workOrderQueues: Record<string, WorkOrder[]>
  advanceWorkOrder: (machineId: string, incrementQty: number) => void
  initWorkOrders: () => void

  // ─── 신규: Export / Import / URL 직렬화 ─────────────────────────
  exportConfig: () => string
  importConfig: (json: string) => void

  // ─── 2단계: 커스텀 계산 지표 ─────────────────────────────────────
  computedMetrics: ComputedMetric[]
  addComputedMetric: (metric: Omit<ComputedMetric, "id">) => void
  updateComputedMetric: (id: string, patch: Partial<ComputedMetric>) => void
  removeComputedMetric: (id: string) => void

  // ─── 2단계: 동적 룰 엔진 ─────────────────────────────────────────
  rules: Rule[]
  addRule: (rule: Omit<Rule, "id" | "lastTriggeredAt">) => void
  updateRule: (id: string, patch: Partial<Rule>) => void
  removeRule: (id: string) => void
  touchRuleTrigger: (id: string, ts: number) => void

  // ─── 4단계: MES 폐루프 이관 로그 ────────────────────────────────
  reroutingLog: ReroutingEvent[]
  rerouteWorkOrder: (fromMachineId: string, reason?: string) => void
  updateReroutingStatus: (id: string, status: ReroutingEvent["status"]) => void

  // ─── 3단계: 저작 도구 ────────────────────────────────────────────
  /** 편집 모드 활성화 여부 */
  editMode: boolean
  toggleEditMode: () => void
  /** 그리드 스냅 단위 */
  snapUnit: number
  setSnapUnit: (unit: number) => void
  /** 엔티티별 3D 스케일 */
  entityScales: Record<string, EntityScale>
  setEntityScale: (entityId: string, scale: EntityScale) => void
  /** 엔티티 위치 업데이트 (TransformControls 드래그 완료 시) */
  updateEntityPosition: (entityId: string, x: number, z: number) => void

  // ─── 3단계: 자유 레이아웃 매니저 ──────────────────────────────────
  layoutConfig: LayoutConfig
  setLayoutConfig: (config: LayoutConfig) => void
  updatePanel: (id: LayoutPanelId, patch: Partial<LayoutPanel>) => void
  setLayoutColumns: (columns: number) => void
}

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  // ── 기존 ─────────────────────────────────────────────────────────
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

  placedEntities: DEFAULT_PLACED_ENTITIES,
  placementMode: null,
  enterPlacementMode: (type, poolId, label, modelUrl) => set({ placementMode: { type, poolId, label, modelUrl } }),
  exitPlacementMode: () => set({ placementMode: null }),
  placeEntity: (poolId, type, x, z, label) =>
    set((state) => {
      if (state.placedEntities.some((e) => e.id === poolId)) return {}
      const modelUrl = state.placementMode?.modelUrl
      const newEntity: PlacedEntity = { id: poolId, type, x, z, label: label ?? poolId, ...(modelUrl ? { modelUrl } : {}) }
      const cfg = makeDefaultEntityConfig(poolId, label ?? poolId)
      const patch: Partial<FactoryStore> & Pick<FactoryStore, "placedEntities" | "placementMode" | "dashboardConfig"> = {
        placedEntities: [...state.placedEntities, newEntity],
        placementMode: null,
        dashboardConfig: {
          ...state.dashboardConfig,
          entities: { ...state.dashboardConfig.entities, [poolId]: cfg },
        },
      }
      if (type !== "robot" && type !== "custom") {
        patch.workOrders = { ...state.workOrders, [poolId]: makeWorkOrder() }
        patch.workOrderQueues = { ...state.workOrderQueues, [poolId]: [makeWorkOrder(), makeWorkOrder()] }
      }
      return patch
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

  // ── 신규: 대시보드 설정 ───────────────────────────────────────────
  dashboardConfig: makeDefaultDashboardConfig(DEFAULT_PLACED_ENTITIES),

  setDashboardConfig: (config) => set({ dashboardConfig: config }),

  updateEntityConfig: (entityId, patch) =>
    set((state) => {
      const prev = state.dashboardConfig.entities[entityId] ?? makeDefaultEntityConfig(entityId, entityId)
      return {
        dashboardConfig: {
          ...state.dashboardConfig,
          entities: {
            ...state.dashboardConfig.entities,
            [entityId]: { ...prev, ...patch },
          },
        },
      }
    }),

  setSimTimeScale: (scale) =>
    set((state) => ({
      dashboardConfig: { ...state.dashboardConfig, simTimeScale: scale },
    })),

  setGaussianNoiseFactor: (factor) =>
    set((state) => ({
      dashboardConfig: { ...state.dashboardConfig, gaussianNoiseFactor: Math.max(0, Math.min(1, factor)) },
    })),

  captureCamera: (camera) =>
    set((state) => ({
      dashboardConfig: { ...state.dashboardConfig, camera },
    })),

  // ── 신규: MES WorkOrder ──────────────────────────────────────────
  workOrders: {},
  workOrderQueues: {},

  initWorkOrders: () => {
    const { placedEntities } = get()
    const machines = placedEntities.filter((e) => e.type !== "robot")
    const orders: Record<string, WorkOrder> = {}
    const queues: Record<string, WorkOrder[]> = {}
    for (const m of machines) {
      orders[m.id] = makeWorkOrder()
      queues[m.id] = [makeWorkOrder(), makeWorkOrder()]
    }
    set({ workOrders: orders, workOrderQueues: queues })
  },

  advanceWorkOrder: (machineId, incrementQty) => {
    set((state) => {
      const wo = state.workOrders[machineId]
      if (!wo) return {}
      const newQty = wo.currentQuantity + incrementQty
      if (newQty >= wo.targetQuantity) {
        // 작업 완료 → 큐에서 다음 작업 꺼내기
        const queue = [...(state.workOrderQueues[machineId] ?? [])]
        const next = queue.shift() ?? makeWorkOrder()
        const newQueue = [...queue, makeWorkOrder()] // 큐를 보충
        return {
          workOrders: { ...state.workOrders, [machineId]: next },
          workOrderQueues: { ...state.workOrderQueues, [machineId]: newQueue },
        }
      }
      return {
        workOrders: {
          ...state.workOrders,
          [machineId]: { ...wo, currentQuantity: newQty },
        },
      }
    })
  },

  // ── 신규: Export / Import ─────────────────────────────────────────
  exportConfig: () => {
    const { dashboardConfig, placedEntities, entityScales, layoutConfig, computedMetrics, rules } = get()
    return JSON.stringify({ dashboardConfig, placedEntities, entityScales, layoutConfig, computedMetrics, rules }, null, 2)
  },

  importConfig: (json) => {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>
      if (parsed.dashboardConfig) set({ dashboardConfig: parsed.dashboardConfig as DashboardConfig })
      if (parsed.placedEntities) set({ placedEntities: parsed.placedEntities as PlacedEntity[] })
      if (parsed.entityScales) set({ entityScales: parsed.entityScales as Record<string, EntityScale> })
      if (parsed.layoutConfig) {
        const lc = parsed.layoutConfig as Record<string, unknown>
        // v1 (col/row 문자열) → v2 전환: 기본 레이아웃으로 초기화
        if ((lc.version as number) !== 2) {
          set({ layoutConfig: DEFAULT_LAYOUT })
        } else {
          set({ layoutConfig: lc as unknown as LayoutConfig })
        }
      }
      if (parsed.rules) set({ rules: parsed.rules as Rule[] })
      if (parsed.computedMetrics) set({ computedMetrics: parsed.computedMetrics as ComputedMetric[] })
    } catch {
      console.error("[importConfig] JSON 파싱 오류")
    }
  },

  // ── 2단계: 커스텀 계산 지표 ──────────────────────────────────────
  computedMetrics: [],

  addComputedMetric: (metric) => {
    const id = `cm-${Date.now()}`
    set((state) => ({ computedMetrics: [...state.computedMetrics, { ...metric, id }] }))
  },

  updateComputedMetric: (id, patch) =>
    set((state) => ({
      computedMetrics: state.computedMetrics.map((m) => m.id === id ? { ...m, ...patch } : m),
    })),

  removeComputedMetric: (id) =>
    set((state) => ({ computedMetrics: state.computedMetrics.filter((m) => m.id !== id) })),

  // ── 2단계: 동적 룰 엔진 ──────────────────────────────────────────
  rules: [],

  addRule: (rule) => {
    const id = `rule-${Date.now()}`
    set((state) => ({
      rules: [...state.rules, { ...rule, id, lastTriggeredAt: 0 }],
    }))
  },

  updateRule: (id, patch) =>
    set((state) => ({
      rules: state.rules.map((r) => r.id === id ? { ...r, ...patch } : r),
    })),

  removeRule: (id) =>
    set((state) => ({ rules: state.rules.filter((r) => r.id !== id) })),

  touchRuleTrigger: (id, ts) =>
    set((state) => ({
      rules: state.rules.map((r) => r.id === id ? { ...r, lastTriggeredAt: ts } : r),
    })),

  // ── 4단계: MES 폐루프 이관 ───────────────────────────────────────
  reroutingLog: [],

  rerouteWorkOrder: (fromMachineId) => {
    const state = get()
    const wo = state.workOrders[fromMachineId]
    if (!wo) return

    // 유휴 상태이거나 결함 없는 동일 타입 다른 기계를 찾는다
    const fromEntity = state.placedEntities.find((e) => e.id === fromMachineId)
    if (!fromEntity) return

    const candidates = state.placedEntities.filter((e) =>
      e.id !== fromMachineId &&
      e.type === fromEntity.type &&
      e.type !== "robot"
    )
    if (candidates.length === 0) return

    // 가장 WorkOrder 큐가 적은 기계 선택
    const target = candidates.reduce((best, cur) => {
      const bestQ = (state.workOrderQueues[best.id] ?? []).length
      const curQ = (state.workOrderQueues[cur.id] ?? []).length
      return curQ < bestQ ? cur : best
    }, candidates[0])

    const eventId = `reroute-${Date.now()}`
    const event: ReroutingEvent = {
      id: eventId,
      ts: Date.now(),
      fromMachineId,
      toMachineId: target.id,
      workOrder: { ...wo, currentQuantity: 0 }, // 이관 시 진척도 초기화
      status: "rerouting",
    }

    // 원본 기계 WorkOrder를 큐에서 다음 것으로 교체
    const fromQueue = [...(state.workOrderQueues[fromMachineId] ?? [])]
    const nextWo = fromQueue.shift()

    // 대상 기계 큐 앞에 삽입 (S급 우선순위 강제)
    const toQueue = [...(state.workOrderQueues[target.id] ?? [])]
    toQueue.unshift({ ...wo, priority: "S", currentQuantity: 0 })

    set((s) => ({
      reroutingLog: [event, ...s.reroutingLog].slice(0, 20),
      workOrders: {
        ...s.workOrders,
        [fromMachineId]: nextWo ?? makeWorkOrder(),
      },
      workOrderQueues: {
        ...s.workOrderQueues,
        [fromMachineId]: [...fromQueue],
        [target.id]: toQueue,
      },
    }))

    // 2초 후 completed 상태로 전환
    setTimeout(() => {
      get().updateReroutingStatus(eventId, "completed")
    }, 2000)
  },

  updateReroutingStatus: (id, status) =>
    set((state) => ({
      reroutingLog: state.reroutingLog.map((e) => e.id === id ? { ...e, status } : e),
    })),

  // ── 3단계: 저작 도구 ─────────────────────────────────────────────
  editMode: false,
  toggleEditMode: () => set((state) => ({ editMode: !state.editMode })),

  snapUnit: 1.0,
  setSnapUnit: (unit) => set({ snapUnit: unit }),

  entityScales: {},
  setEntityScale: (entityId, scale) =>
    set((state) => ({ entityScales: { ...state.entityScales, [entityId]: scale } })),

  updateEntityPosition: (entityId, x, z) =>
    set((state) => ({
      placedEntities: state.placedEntities.map((e) =>
        e.id === entityId ? { ...e, x, z } : e
      ),
    })),

  // ── 3단계: 자유 레이아웃 매니저 ──────────────────────────────────
  layoutConfig: DEFAULT_LAYOUT,

  setLayoutConfig: (config) => set({ layoutConfig: config }),

  updatePanel: (id, patch) =>
    set((state) => ({
      layoutConfig: {
        ...state.layoutConfig,
        panels: state.layoutConfig.panels.map((p) => p.id === id ? { ...p, ...patch } : p),
      },
    })),

  setLayoutColumns: (columns: number) =>
    set((state) => ({ layoutConfig: { ...state.layoutConfig, columns } })),
}))
