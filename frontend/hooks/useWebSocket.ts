"use client"
import { useEffect, useRef } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { WSMessage } from "@/lib/types"

export function useWebSocket(url: string) {
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
