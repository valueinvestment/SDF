"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import { SensorChart } from "@/components/SensorChart"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"
const MACHINES = ["M1", "M2", "M3", "M4", "M5"]

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const robotPosRef = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef)

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4 space-y-4">
      <h1 className="text-2xl font-bold">SDF Digital Twin</h1>
      <FactoryCanvas canvasRef={canvasRef} />
      <div className="grid grid-cols-5 gap-2">
        {MACHINES.map((id) => <SensorChart key={id} machineId={id} />)}
      </div>
    </main>
  )
}
