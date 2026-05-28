"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const robotPosRef = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef)

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">SDF Digital Twin</h1>
      <FactoryCanvas canvasRef={canvasRef} />
    </main>
  )
}
