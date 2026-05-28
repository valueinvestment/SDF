# SDF 디지털 트윈 — 동적 캔버스 & 인터랙티브 시각화 설계 스펙

**Date:** 2026-05-28  
**Status:** Approved  
**Supersedes:** 2026-05-27-sdf-digital-twin-design.md (섹션 1 캔버스, 섹션 3 프론트엔드 일부)

---

## 1. 변경 개요

기존 고정 공장 바닥(5대 기계 + 3대 로봇 하드코딩)을 **동적 배치 캔버스**로 전환합니다.

| 기존 | 변경 후 |
|---|---|
| 씬 시작 시 M1~M5, R1~R3 자동 배치 | 팔레트에서 선택 후 클릭으로 배치 |
| 단색 박스 기계 메시 | 유형별 서브메시 구조 (body/motor/actuator/sensor_unit) |
| 기계/로봇 클릭 불가 | 클릭 선택 → 상세 패널 + WS 상세 구독 |
| 로봇 경로 미표시 | 선택된 로봇의 추천 경로 점선으로 시각화 |
| 고장 시 기계 전체 빨간색 | 고장 부위 서브메시만 색상 변경 |

백엔드 데이터 스트리밍 구조(M1~M5, R1~R3)는 변경 없음. 신규 상세 구독 채널만 추가.

---

## 2. 아키텍처 선택 근거

**접근 A 채택 — 프론트엔드 주도 배치 + 백엔드 고정 풀**

백엔드는 항상 5대 기계 + 3대 로봇의 전체 데이터를 스트리밍합니다. 프론트엔드의 `placedEntities` 스토어가 어떤 엔티티를 캔버스 어디에 렌더링할지 결정합니다. 배치되지 않은 엔티티의 데이터는 수신하지만 무시합니다.

선택된 엔티티에 대해서만 별도의 상세 데이터 구독을 신청합니다 (`subscribe_detail`). 이를 통해 센서 스트림(10Hz)과 상세 데이터(2Hz)를 분리합니다.

---

## 3. 배치 시스템

### 3.1 팔레트 아이템 정의

```typescript
export type MachineType = "press" | "cnc" | "conveyor"
export type EntityType = MachineType | "robot"

export interface PlacedEntity {
  id: string           // 백엔드 풀 ID (M1~M5, R1~R3)
  type: EntityType
  x: number            // Three.js 월드 좌표
  z: number
  label: string
}

export interface PaletteItem {
  poolId: string
  type: EntityType
  label: string
  isPlaced: boolean    // true이면 팔레트에서 비활성화
}
```

### 3.2 배치 플로우

1. 팔레트에서 유형 클릭 → `placementMode = { type, poolId }` 설정
2. 캔버스 커서 십자선(+) 변경
3. 바닥 위 마우스 이동 시 반투명 고스트 메시 표시
4. 다른 메시와 1.5 유닛 이내 겹침 → 고스트 빨간색, 클릭 무효
5. 바닥 클릭 → Raycaster 교차점 (x, z) 추출 → `placeEntity()` 호출
6. `placementMode = null`, 커서 복원

### 3.3 Zustand 스토어 추가 필드

```typescript
interface FactoryStore {
  // 기존 필드 유지 ...

  // 배치
  placedEntities: PlacedEntity[]
  placementMode: { type: EntityType; poolId: string } | null

  // 선택
  selectedEntityId: string | null

  // 상세 데이터
  machineDetails: Record<string, MachineDetail>
  robotPaths: Record<string, RobotPathDetail>
  componentFaults: Record<string, ComponentFaultMap>

  // 액션
  enterPlacementMode: (type: EntityType, poolId: string) => void
  exitPlacementMode: () => void
  placeEntity: (poolId: string, type: EntityType, x: number, z: number) => void
  removeEntity: (poolId: string) => void
  selectEntity: (id: string | null) => void
  setMachineDetail: (detail: MachineDetail) => void
  setRobotPath: (path: RobotPathDetail) => void
  setComponentFault: (fault: ComponentFaultMap) => void
}
```

---

## 4. 기계 서브메시 구조

### 4.1 파트 구성 (MVP 러프)

모든 기계 유형은 4개 파트로 구성된 `THREE.Group`입니다.

```
MachineGroup (userData.entityId = poolId)
├── body         BoxGeometry    — 메인 하우징
├── motor        CylinderGeometry — 구동/스핀들
├── actuator     BoxGeometry    — 작동부/공구헤드
└── sensor_unit  SphereGeometry — 센서 모듈
```

| 유형 | body | motor | actuator | sensor_unit |
|---|---|---|---|---|
| press | 넓고 납작한 박스 (1.4×0.6×1.4) | 상단 유압 실린더 | 프레스 헤드 (상단) | 우상단 소구 |
| cnc | 정육면체 (1.2×1.2×1.2) | 좌측 스핀들 실린더 | 상단 공구 헤드 | 전면 소구 |
| conveyor | 긴 얇은 박스 (2.4×0.3×0.8) | 우측 모터 실린더 | 상단 벨트 플레이트 | 중앙 소구 |

### 4.2 파트별 독립 머티리얼

서브메시 머티리얼은 반드시 `.clone()` — 공유 머티리얼 사용 시 한 파트의 색상 변경이 동일 유형 모든 기계에 영향.

```typescript
mesh.material = getBaseMaterial().clone()
mesh.userData.partName = sub.name
```

### 4.3 Agent A 컴포넌트 → 파트명 매핑

```python
COMPONENT_PART_MAP = {
  "bearing": "motor",   "spindle": "motor",    "motor_surge": "motor",
  "hydraulic": "actuator", "press_head": "actuator", "belt": "actuator",
  "sensor": "sensor_unit",
  "temperature": "body", "overheating": "body",
}
```

---

## 5. 선택 시스템

### 5.1 레이캐스팅

`placement mode` 비활성 상태에서 캔버스 클릭 시 동작합니다.

- 클릭된 객체의 최상위 부모까지 `userData.entityId`를 탐색
- 서브메시 클릭도 부모 Group의 entityId를 반환
- 빈 바닥 클릭 시 선택 해제

### 5.2 선택 시각 피드백

`THREE.LineSegments` 엣지 하이라이트 (노란색 `0xfbbf24`) — 고장 색상과 충돌 없음.

선택/해제 시 outline 메시를 씬에 추가/제거합니다. Group의 자식으로 추가하므로 엔티티 이동과 함께 따라옵니다.

### 5.3 선택 → 상세 구독 흐름

```
selectEntity("M3") 호출
  → WS 전송: { type: "subscribe_detail", payload: { entityId: "M3" } }
  → MachineDetailPanel 슬라이드인

selectEntity(null) 또는 다른 엔티티 선택
  → WS 전송: { type: "unsubscribe_detail", payload: { entityId: "M3" } }
  → MachineDetailPanel 슬라이드아웃
```

---

## 6. WebSocket 상세 구독 프로토콜

### 6.1 신규 클라이언트 → 서버 메시지

```typescript
{ type: "subscribe_detail";   payload: { entityId: string } }
{ type: "unsubscribe_detail"; payload: { entityId: string } }
```

### 6.2 신규 서버 → 클라이언트 메시지

```typescript
// 기계 선택 시, 2Hz 스트리밍
interface MachineDetail {
  machineId: string
  ts: number
  operationRate: number                        // 0–100 %
  components: Record<string, {
    wear: number                               // 0–100 %
    temperature: number                        // °C
    status: "ok" | "warn" | "critical"
  }>
  thermalGrid: number[][]                      // 4×4, 각 셀 0–1
}

// 로봇 선택 시, 1회 + 이동 중 주기적 업데이트
interface RobotPathDetail {
  robotId: string
  currentPos: [number, number]
  recommendedPath: [number, number][]
  targetEntityId: string | null
  eta: number
  pathType: "idle_patrol" | "dispatch" | "returning"
}

// Agent A 완료 시 1회 전송
interface ComponentFaultMap {
  machineId: string
  faultedParts: Record<string, {
    severity: "warn" | "critical"
    description: string
  }>
}
```

### 6.3 백엔드 구독 관리

```python
class WebSocketGateway:
    _detail_subscriptions: dict[WebSocket, str]  # ws → entityId

    async def handle_client_message(self, ws, raw):
        msg = json.loads(raw)
        if msg["type"] == "subscribe_detail":
            self._detail_subscriptions[ws] = msg["payload"]["entityId"]
        elif msg["type"] == "unsubscribe_detail":
            self._detail_subscriptions.pop(ws, None)

    async def broadcast_detail(self, entity_id, message):
        """entity_id를 구독 중인 클라이언트에만 전송"""
```

---

## 7. 로봇 경로 시각화

- `THREE.LineDashedMaterial` (색상 `0x10b981`, dashSize 0.4, gapSize 0.2)
- `computeLineDistances()` 호출 필수
- 경로 라인은 `pathLinesRef`에 별도 관리
- 선택 해제 시 `line.geometry.dispose()` + `scene.remove()`
- 여러 로봇 동시 선택 불가 (단일 선택)

---

## 8. 기계 상세 패널 UI 구성

```
MachineDetailPanel (우측 슬라이드인, w-72)
├── MachineHeader      — ID, 유형, 가동 상태, 가동률
├── ComponentWearBars  — ECharts 수평 바 차트 (파트별 노후도 %)
├── ThermalHeatmap     — ECharts heatmap (4×4 thermalGrid)
└── SelectedPartChart  — 클릭한 파트의 실시간 온도 라인 차트
```

모든 차트는 `machine_detail` 메시지 수신 시 업데이트 (2Hz). `notMerge: false` append 모드 사용.

---

## 9. 신규/변경 파일 목록

### 프론트엔드
| 파일 | 변경 유형 | 내용 |
|---|---|---|
| `lib/types.ts` | 수정 | PlacedEntity, PaletteItem, MachineDetail, RobotPathDetail, ComponentFaultMap 추가 |
| `lib/threeHelpers.ts` | 수정 | buildMachineGroup, buildPathLine, addSelectionOutline, removeSelectionOutline 추가 |
| `store/factoryStore.ts` | 수정 | placedEntities, placementMode, selectedEntityId, machineDetails 등 추가 |
| `hooks/useThreeScene.ts` | 수정 | 레이캐스팅, 고스트 메시, 경로 라인, 서브메시 색상 업데이트 추가 |
| `hooks/useWebSocket.ts` | 수정 | machine_detail, robot_path, component_fault 메시지 처리 추가 |
| `components/Palette.tsx` | 신규 | 팔레트 사이드바 UI |
| `components/MachineDetailPanel.tsx` | 신규 | 기계 상세 패널 (노후도 바, 히트맵, 라인 차트) |
| `components/RobotDetailPanel.tsx` | 신규 | 로봇 상세 패널 (경로 유형, 목적지, ETA) |
| `app/page.tsx` | 수정 | Palette, 상세 패널 마운트, 레이아웃 변경 |

### 백엔드
| 파일 | 변경 유형 | 내용 |
|---|---|---|
| `gateway/ws_gateway.py` | 수정 | handle_client_message, broadcast_detail, _detail_subscriptions 추가 |
| `simulator/detail_simulator.py` | 신규 | MachineDetail, RobotPathDetail 데이터 생성 |
| `agents/orchestrator.py` | 수정 | component_fault 메시지 브로드캐스트 추가 |
| `main.py` | 수정 | detail_loop 태스크, WS receive 메시지 라우팅 추가 |

---

## 10. MVP 범위 외

- 드래그 앤 드롭 배치 (클릭 배치만 구현)
- 기계/로봇 배치 후 위치 편집
- 배치 상태 localStorage 저장 (세션 내 유지만)
- 로봇 서브메시 분리 (로봇은 단일 메시 유지)
- 3D 기계 모델 외부 파일 로딩 (절차적 생성만)
