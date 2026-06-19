"use client"
/**
 * useRuleEngine
 *
 * 매 센서 틱마다 rules를 평가하고 트리거된 룰의 헤드리스 액션을 실행한다.
 * - overlay_color: 3D 메쉬 색상 오버레이 (ref 콜백 주입)
 * - alert_popup:   Zustand setActiveAlert 트리거
 * - play_sound:    Web Audio API 합성음
 * - webhook_post:  Slack/Discord webhook fetch POST
 *
 * 아키텍처 규칙 준수:
 * - 3D 오버레이는 React 렌더 사이클 외부에서 직접 mesh.material 조작
 * - Zustand subscribe()로 machines 변화 감지 (렌더 트리거 없음)
 */

import { useEffect, useRef, useCallback } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import { evaluateCondition, evaluateFormula } from "@/lib/formulaEngine"
import type { Rule, RuleAction, MachineState } from "@/lib/types"

// Web Audio API 오디오 컨텍스트 — 싱글톤
let audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  return audioCtx
}

/** 네온풍 경고음: 주파수 기반 비프 + 감쇠 */
function playAlertSound(frequency = 880, durationMs = 300) {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = frequency
    osc.type = "sawtooth"
    gain.gain.setValueAtTime(0.18, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + durationMs / 1000)
  } catch {
    // 브라우저 정책으로 AudioContext 생성 불가 시 무시
  }
}

/** Webhook POST 전송 */
async function postWebhook(
  url: string,
  channel: "slack" | "discord" | undefined,
  payload: object,
) {
  try {
    const body = channel === "slack"
      ? JSON.stringify({ text: `🚨 SDF Digital Twin Alert\n${JSON.stringify(payload, null, 2)}` })
      : channel === "discord"
      ? JSON.stringify({ content: `🚨 **SDF Digital Twin Alert**\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`` })
      : JSON.stringify(payload)

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      mode: "no-cors", // Slack/Discord webhook은 no-cors
    })
  } catch {
    console.warn("[useRuleEngine] webhook 전송 실패:", url)
  }
}

/** Three.js 메쉬 오버레이 콜백 타입 */
export type MeshOverlayFn = (machineId: string, color: string | null) => void

interface UseRuleEngineOptions {
  /** 3D 메쉬 색상 오버레이 콜백 (useThreeScene에서 주입) */
  onMeshOverlay?: MeshOverlayFn
}

export function useRuleEngine({ onMeshOverlay }: UseRuleEngineOptions = {}) {
  const onMeshOverlayRef = useRef(onMeshOverlay)
  onMeshOverlayRef.current = onMeshOverlay

  const evaluateTick = useCallback(() => {
    const store = useFactoryStore.getState()
    const { machines, rules, computedMetrics, touchRuleTrigger, setActiveAlert } = store
    const now = Date.now()

    for (const [machineId, machineState] of Object.entries(machines)) {
      const relevantRules = rules.filter(
        (r) => r.enabled && (r.machineId === null || r.machineId === machineId),
      )
      if (!relevantRules.length) continue

      // 기본 변수 맵 구성
      const vars: Record<string, number> = {
        vibration: machineState.vibration,
        temperature: machineState.temperature,
        current: machineState.current,
      }

      // 커스텀 지표 계산 후 변수 맵에 추가
      for (const cm of computedMetrics) {
        if (cm.machineId !== null && cm.machineId !== machineId) continue
        const result = evaluateFormula(cm.formula, vars)
        if (result.ok) vars[cm.id] = result.value
      }

      for (const rule of relevantRules) {
        // cooldown 체크
        if (now - rule.lastTriggeredAt < rule.cooldownMs) continue

        let triggered = false
        try {
          triggered = evaluateCondition(rule.condition, vars)
        } catch {
          // 조건 파싱 오류는 무시 (실시간 입력 중 발생 가능)
        }
        if (!triggered) continue

        touchRuleTrigger(rule.id, now)

        const alertPayload = {
          ruleId: rule.id,
          ruleName: rule.name,
          machineId,
          condition: rule.condition,
          sensorValues: { vibration: vars.vibration, temperature: vars.temperature, current: vars.current },
          triggeredAt: new Date(now).toISOString(),
        }

        for (const action of rule.actions) {
          executeAction(action, machineId, alertPayload, {
            setActiveAlert,
            onMeshOverlay: onMeshOverlayRef.current,
          })
        }
      }
    }
  }, [])

  // machines 변화 감지 → 평가 (Zustand subscribe, 렌더 트리거 없음)
  useEffect(() => {
    let prevMachines = useFactoryStore.getState().machines
    const unsub = useFactoryStore.subscribe((state) => {
      if (state.machines !== prevMachines) {
        prevMachines = state.machines
        evaluateTick()
      }
    })
    return unsub
  }, [evaluateTick])
}

function executeAction(
  action: RuleAction,
  machineId: string,
  payload: object,
  ctx: {
    setActiveAlert: (a: { machineId: string; ts: number } | null) => void
    onMeshOverlay?: MeshOverlayFn
  },
) {
  switch (action.type) {
    case "overlay_color":
      ctx.onMeshOverlay?.(machineId, action.color ?? "#ef4444")
      // 3초 후 오버레이 해제
      setTimeout(() => ctx.onMeshOverlay?.(machineId, null), 3000)
      break

    case "alert_popup":
      ctx.setActiveAlert({ machineId, ts: Date.now() })
      setTimeout(() => ctx.setActiveAlert(null), 3000)
      break

    case "play_sound":
      playAlertSound(action.soundFrequency && action.soundFrequency > 0 ? action.soundFrequency : 880)
      break

    case "webhook_post":
      if (action.webhookUrl) {
        postWebhook(action.webhookUrl, action.webhookChannel, payload)
      }
      break
  }
}
