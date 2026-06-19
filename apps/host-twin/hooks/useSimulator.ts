"use client"
/**
 * useSimulator
 *
 * WebSocket 연결이 없거나 끊어진 상태에서 동작하는
 * 프론트엔드 자체 독립 모킹 타이머 루프.
 *
 * 특징:
 * - 사인파(Sine Wave) 기반 데이터 생성 (avg ± amplitude)
 * - 가우시안 노이즈(Gaussian Noise) 분산 필터 적용
 * - 시뮬레이션 배속(1x / 2x / 5x) 지원
 * - 기계별 고장 주기 시뮬레이션
 * - MES WorkOrder currentQuantity 자동 증가
 * - WebSocket 연결 중에는 자동 정지 (wsConnected prop)
 */

import { useEffect, useRef, useCallback } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { SensorSnapshot, SimParamsForSensor } from "@sdf/types"

/** Box-Muller 변환: 표준 정규분포 난수 생성 */
function gaussianRandom(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

/**
 * 사인파 + 가우시안 노이즈 합성
 * @param phase     - 현재 위상 (라디안)
 * @param params    - min/avg/max 설정
 * @param noiseFactor - 0~1, 가우시안 노이즈 강도
 */
function sineWithNoise(phase: number, params: SimParamsForSensor, noiseFactor: number): number {
  const amplitude = (params.max - params.min) / 2
  const sineValue = params.avg + amplitude * Math.sin(phase)
  const noise = gaussianRandom() * amplitude * noiseFactor * 0.3
  return Math.max(params.min, Math.min(params.max, sineValue + noise))
}

// 기계별 사인파 위상 오프셋 (각 기계가 서로 다른 주기로 진동)
const PHASE_OFFSETS: Record<string, number> = {}
function getPhaseOffset(id: string): number {
  if (PHASE_OFFSETS[id] === undefined) {
    PHASE_OFFSETS[id] = Math.random() * Math.PI * 2
  }
  return PHASE_OFFSETS[id]
}

const BASE_TICK_MS = 500        // 기본 업데이트 주기 (0.5초 = 2Hz)
const SINE_PERIOD_SEC = 30      // 사인파 1주기 시간(초, 배속 전)

interface UseSimulatorOptions {
  /** WebSocket이 연결되어 있으면 시뮬레이터 정지 */
  wsConnected: boolean
}

export function useSimulator({ wsConnected }: UseSimulatorOptions) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef(0) // 누적 시뮬레이션 시간 (배속 적용 후 초)
  const faultTimerRef = useRef<Record<string, number>>({}) // 기계별 다음 고장까지 남은 시뮬 시간

  const applySnapshot = useFactoryStore((s) => s.applySnapshot)
  const setActiveAlert = useFactoryStore((s) => s.setActiveAlert)
  const advanceWorkOrder = useFactoryStore((s) => s.advanceWorkOrder)
  const initWorkOrders = useFactoryStore((s) => s.initWorkOrders)

  const tick = useCallback(() => {
    const store = useFactoryStore.getState()
    const { placedEntities, dashboardConfig, workOrders } = store
    const { simTimeScale, gaussianNoiseFactor, entities } = dashboardConfig

    // 배속 적용: 한 틱(0.5s 실제)이 simTimeScale * 0.5초 만큼 시뮬레이션 진행
    const simDeltaSec = (BASE_TICK_MS / 1000) * simTimeScale
    elapsedRef.current += simDeltaSec

    const machineSensor: SensorSnapshot["machines"] = {}
    const ts = Date.now()

    const machines = placedEntities.filter((e) => e.type !== "robot")

    for (const entity of machines) {
      const cfg = entities[entity.id]
      if (!cfg) continue

      const offset = getPhaseOffset(entity.id)
      const phase = ((elapsedRef.current % SINE_PERIOD_SEC) / SINE_PERIOD_SEC) * 2 * Math.PI + offset

      // 고장 주기 초기화
      if (faultTimerRef.current[entity.id] === undefined) {
        faultTimerRef.current[entity.id] = cfg.simParams.faultIntervalSec * (0.8 + Math.random() * 0.4)
      }
      faultTimerRef.current[entity.id] -= simDeltaSec

      let status: "normal" | "degraded" | "fault" = "normal"
      if (faultTimerRef.current[entity.id] <= 0) {
        status = "fault"
        // 고장 알림 발생 (3초 동안 고장 상태 유지 후 복구)
        setActiveAlert({ machineId: entity.id, ts })
        setTimeout(() => {
          setActiveAlert(null)
        }, 3000 / simTimeScale)
        // 타이머 리셋
        faultTimerRef.current[entity.id] = cfg.simParams.faultIntervalSec * (0.8 + Math.random() * 0.4)
      } else if (faultTimerRef.current[entity.id] <= 10) {
        status = "degraded"
      }

      const vibration   = sineWithNoise(phase,       cfg.simParams.vibration,   gaussianNoiseFactor)
      const temperature = sineWithNoise(phase * 0.7, cfg.simParams.temperature, gaussianNoiseFactor)
      const current     = sineWithNoise(phase * 1.3, cfg.simParams.current,     gaussianNoiseFactor)

      machineSensor[entity.id] = { vibration, temperature, current, status }

      // MES WorkOrder: 정상 가동 시 생산량 증가
      if (status === "normal") {
        const wo = workOrders[entity.id]
        if (wo) {
          const rate = simDeltaSec * 0.1 // 1배속 기준 초당 0.1개 생산
          advanceWorkOrder(entity.id, rate)
        }
      }
    }

    const snapshot: SensorSnapshot = {
      ts,
      machines: machineSensor,
      robots: {}, // 로봇은 Three.js 자체 애니메이션 루프에서 관리
    }
    applySnapshot(snapshot)
  }, [applySnapshot, setActiveAlert, advanceWorkOrder])

  useEffect(() => {
    // WorkOrder 초기화 (최초 1회)
    if (Object.keys(useFactoryStore.getState().workOrders).length === 0) {
      initWorkOrders()
    }
  }, [initWorkOrders])

  useEffect(() => {
    if (wsConnected) {
      // WebSocket이 연결되면 시뮬레이터 정지
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    // WebSocket 없을 때 시뮬레이터 가동
    if (timerRef.current !== null) clearInterval(timerRef.current)
    timerRef.current = setInterval(tick, BASE_TICK_MS)

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [wsConnected, tick])

  // simTimeScale 변경 시 인터벌 재시작 (배속 변경 즉시 반영)
  const simTimeScale = useFactoryStore((s) => s.dashboardConfig.simTimeScale)
  useEffect(() => {
    if (wsConnected || timerRef.current === null) return
    clearInterval(timerRef.current)
    timerRef.current = setInterval(tick, BASE_TICK_MS)
  }, [simTimeScale, wsConnected, tick])
}
