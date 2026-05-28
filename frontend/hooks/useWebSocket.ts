"use client"
import { useEffect, useRef } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { WSMessage, RobotState } from "@/lib/types"
import * as THREE from "three"
import { getMachineMaterial } from "@/lib/threeHelpers"
import type { RobotPositionRef, MachineStatusRef } from "@/hooks/useThreeScene"

export function useWebSocket(
  url: string,
  robotPosRef?: React.MutableRefObject<RobotPositionRef>,
  machineMeshesRef?: React.MutableRefObject<MachineStatusRef>
) {
  const queueRef = useRef<WSMessage[]>([])
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const store = useFactoryStore.getState()
    const ws = new WebSocket(url)

    ws.onmessage = (e) => {
      try {
        queueRef.current.push(JSON.parse(e.data) as WSMessage)
      } catch {}
    }

    const drain = () => {
      const batch = queueRef.current.splice(0)
      for (const msg of batch) {
        if (msg.type === "sensor_update") {
          if (robotPosRef) {
            for (const [id, robot] of Object.entries(msg.payload.robots as Record<string, RobotState>)) {
              robotPosRef.current[id] = { x: robot.x, y: robot.y }
            }
          }
          if (machineMeshesRef) {
            for (const [id, data] of Object.entries(msg.payload.machines as Record<string, { status: string }>)) {
              const group = machineMeshesRef.current[id]
              if (group) {
                const mat = getMachineMaterial(data.status)
                group.traverse((obj) => {
                  if (obj instanceof THREE.Mesh) {
                    obj.material = mat
                  }
                })
              }
            }
          }
          store.applySnapshot(msg.payload)
        } else if (msg.type === "agent_event") {
          store.addAgentEvent(msg.payload)
        } else if (msg.type === "alert") {
          store.setActiveAlert(msg.payload)
        } else if (msg.type === "robot_dispatch") {
          store.setDispatchCommand(msg.payload)
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
