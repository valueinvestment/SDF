"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import { SensorChart } from "@/components/SensorChart"
import { AgentPanel } from "@/components/AgentPanel"
import { AlertBanner } from "@/components/AlertBanner"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"
const MACHINES = ["M1", "M2", "M3", "M4", "M5"]

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault } = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault)

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4 space-y-4">
      <h1 className="text-2xl font-bold">SDF Digital Twin</h1>
      <AlertBanner />
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <FactoryCanvas canvasRef={canvasRef} />
          <div className="grid grid-cols-5 gap-2">
            {MACHINES.map((id) => <SensorChart key={id} machineId={id} />)}
          </div>
        </div>
        <div>
          <AgentPanel />
        </div>
      </div>
    </main>
  )
}
