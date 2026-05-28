"use client"
import { useEffect, useRef } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { WSMessage, RobotState } from "@/lib/types"
import type { RobotPositionRef, MachineGroupRef } from "@/hooks/useThreeScene"

export function useWebSocket(
  url: string,
  robotPosRef?: React.MutableRefObject<RobotPositionRef>,
  machineGroupsRef?: React.MutableRefObject<MachineGroupRef>,
  updatePathLine?: (robotId: string, path: [number, number][]) => void,
  clearPathLine?: (robotId: string) => void,
  updateComponentFault?: (machineId: string, faults: Record<string, { severity: "warn" | "critical" }>) => void,
) {
  const queueRef = useRef<WSMessage[]>([])
  const rafRef = useRef<number>(0)
  const wsRef = useRef<WebSocket | null>(null)
  const prevSelectedRef = useRef<string | null>(null)

  useEffect(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try { queueRef.current.push(JSON.parse(e.data) as WSMessage) } catch {}
    }

    const drain = () => {
      const store = useFactoryStore.getState()

      // Detect selection change → send subscribe/unsubscribe
      const currentSelected = store.selectedEntityId
      if (currentSelected !== prevSelectedRef.current) {
        if (prevSelectedRef.current && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "unsubscribe_detail", payload: { entityId: prevSelectedRef.current } }))
          if (prevSelectedRef.current.startsWith("R")) clearPathLine?.(prevSelectedRef.current)
        }
        if (currentSelected && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "subscribe_detail", payload: { entityId: currentSelected } }))
        }
        prevSelectedRef.current = currentSelected
      }

      const batch = queueRef.current.splice(0)
      for (const msg of batch) {
        if (msg.type === "sensor_update") {
          if (robotPosRef) {
            for (const [id, robot] of Object.entries(msg.payload.robots as Record<string, RobotState>)) {
              robotPosRef.current[id] = { x: robot.x, y: robot.y }
            }
          }
          store.applySnapshot(msg.payload)
        } else if (msg.type === "agent_event") {
          store.addAgentEvent(msg.payload)
        } else if (msg.type === "alert") {
          store.setActiveAlert(msg.payload)
        } else if (msg.type === "robot_dispatch") {
          store.setDispatchCommand(msg.payload)
        } else if (msg.type === "machine_detail") {
          store.setMachineDetail(msg.payload)
        } else if (msg.type === "robot_path") {
          store.setRobotPath(msg.payload)
          updatePathLine?.(msg.payload.robotId, msg.payload.recommendedPath)
        } else if (msg.type === "component_fault") {
          store.setComponentFault(msg.payload)
          updateComponentFault?.(msg.payload.machineId, msg.payload.faultedParts)
        }
      }

      rafRef.current = requestAnimationFrame(drain)
    }

    rafRef.current = requestAnimationFrame(drain)

    return () => {
      ws.close()
      cancelAnimationFrame(rafRef.current)
    }
  }, [url])
}
