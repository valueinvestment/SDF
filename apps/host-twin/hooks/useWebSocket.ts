"use client"
import { useEffect, useRef, useState } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { WSMessage, RobotState, PlacedEntity } from "@sdf/types"
import type { RobotPositionRef, MachineGroupRef } from "@/hooks/useThreeScene"

function buildSyncPayload(entities: PlacedEntity[]) {
  return {
    type: "sync_entities",
    payload: {
      entities: entities.map((e) => ({
        id: e.id,
        category: e.type === "robot" ? "robot" : "machine",
        x: e.x,
        z: e.z,
      })),
    },
  }
}

export type WsStatus = "connecting" | "connected" | "disconnected" | "error"

export function useWebSocket(
  url: string,
  robotPosRef?: React.MutableRefObject<RobotPositionRef>,
  machineGroupsRef?: React.MutableRefObject<MachineGroupRef>,
  updatePathLine?: (robotId: string, path: [number, number][]) => void,
  clearPathLine?: (robotId: string) => void,
  updateComponentFault?: (machineId: string, faults: Record<string, { severity: "warn" | "critical" }>) => void,
  updateRobotPath?: (robotId: string, waypoints: [number, number][]) => void,
) {
  const queueRef = useRef<WSMessage[]>([])
  const rafRef = useRef<number>(0)
  const wsRef = useRef<WebSocket | null>(null)
  const prevSelectedRef = useRef<string | null>(null)
  const prevEntitiesKeyRef = useRef<string>("")
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelayRef = useRef<number>(1000)
  const [status, setStatus] = useState<WsStatus>("connecting")

  useEffect(() => {
    let active = true

    const connect = () => {
      if (!active) return
      setStatus("connecting")
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (!active) { ws.close(); return }
        console.log("[WS] connected to", url)
        retryDelayRef.current = 1000
        setStatus("connected")
        // Sync current entity state with backend
        const entities = useFactoryStore.getState().placedEntities
        ws.send(JSON.stringify(buildSyncPayload(entities)))
        prevEntitiesKeyRef.current = JSON.stringify(entities)
        // Re-subscribe to detail if something was selected before reconnect
        const selected = prevSelectedRef.current
        if (selected) {
          ws.send(JSON.stringify({ type: "subscribe_detail", payload: { entityId: selected } }))
        }
      }

      ws.onclose = (e) => {
        if (!active) return
        console.warn("[WS] closed", e.code, e.reason, "— retrying in", retryDelayRef.current, "ms")
        setStatus("disconnected")
        retryRef.current = setTimeout(() => {
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 16000)
          connect()
        }, retryDelayRef.current)
      }

      ws.onerror = () => {
        if (!active) return
        setStatus("error")
      }

      ws.onmessage = (e) => {
        if (!active) return
        try {
          const msg = JSON.parse(e.data) as WSMessage
          if (msg.type === "sensor_update") {
            // Directly apply snapshot to bypass queue timing issues
            const p = msg.payload as any
            if (p?.machines) {
              useFactoryStore.getState().applySnapshot(p)
            }
          } else {
            queueRef.current.push(msg)
          }
        } catch (err) {
          console.error("[ws.onmessage] parse error:", err)
        }
      }
    }

    connect()

    const drain = () => {
      try {
        const ws = wsRef.current
        const store = useFactoryStore.getState()

        // Sync entity list changes to backend
        const entities = store.placedEntities
        const entitiesKey = JSON.stringify(entities)
        if (entitiesKey !== prevEntitiesKeyRef.current && ws?.readyState === WebSocket.OPEN) {
          prevEntitiesKeyRef.current = entitiesKey
          ws.send(JSON.stringify(buildSyncPayload(entities)))
        }

        const currentSelected = store.selectedEntityId
        if (currentSelected !== prevSelectedRef.current) {
          if (prevSelectedRef.current && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "unsubscribe_detail", payload: { entityId: prevSelectedRef.current } }))
            if (prevSelectedRef.current.startsWith("R")) clearPathLine?.(prevSelectedRef.current)
          }
          if (currentSelected && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "subscribe_detail", payload: { entityId: currentSelected } }))
          }
          prevSelectedRef.current = currentSelected
        }

        const batch = queueRef.current.splice(0)
        for (const msg of batch) {
          if (msg.type === "sensor_update") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const payload = msg.payload as any
            if (robotPosRef && payload.robots) {
              for (const [id, robot] of Object.entries(payload.robots) as [string, RobotState][]) {
                robotPosRef.current[id] = { x: robot.x, y: robot.y }
              }
            }
            store.applySnapshot(payload)
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
            updateRobotPath?.(msg.payload.robotId, msg.payload.recommendedPath)
          } else if (msg.type === "component_fault") {
            store.setComponentFault(msg.payload)
            updateComponentFault?.(msg.payload.machineId, msg.payload.faultedParts)
          }
        }
      } catch (err) {
        console.error("[drain] error:", err)
      }
      rafRef.current = requestAnimationFrame(drain)
    }

    rafRef.current = requestAnimationFrame(drain)

    return () => {
      active = false
      cancelAnimationFrame(rafRef.current)
      if (retryRef.current) clearTimeout(retryRef.current)
      const ws = wsRef.current
      if (!ws) return
      // Avoid "closed before established" error: wait for connect then close
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close()
      } else {
        ws.close()
      }
    }
  }, [url])

  return { status }
}
