"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import { SensorChart } from "@/components/SensorChart"
import { AgentPanel } from "@/components/AgentPanel"
import { AlertBanner } from "@/components/AlertBanner"
import { Palette } from "@/components/Palette"
import { MachineDetailPanel } from "@/components/MachineDetailPanel"
import { RobotDetailPanel } from "@/components/RobotDetailPanel"
import { useFactoryStore } from "@/store/factoryStore"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault } = useThreeScene(canvasRef)
  useWebSocket(WS_URL, robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault)

  const selectedId = useFactoryStore((s) => s.selectedEntityId)
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const placedMachineIds = placedEntities.filter((e) => e.type !== "robot").map((e) => e.id)

  const isMachineSelected = selectedId?.startsWith("M") ?? false
  const isRobotSelected = selectedId?.startsWith("R") ?? false

  return (
    <main className="bg-gray-950 text-white min-h-screen p-4">
      <h1 className="text-xl font-bold mb-3">SDF 디지털 트윈</h1>
      <AlertBanner />

      <div className="flex gap-3 mt-3">
        <Palette />

        <div className="flex-1 space-y-3 min-w-0">
          <FactoryCanvas canvasRef={canvasRef} />

          {placedMachineIds.length > 0 && (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${Math.min(placedMachineIds.length, 5)}, 1fr)` }}
            >
              {placedMachineIds.map((id) => <SensorChart key={id} machineId={id} />)}
            </div>
          )}
        </div>

        <div className="space-y-3 w-64 flex-shrink-0">
          {isMachineSelected && selectedId && (
            <MachineDetailPanel machineId={selectedId} />
          )}
          {isRobotSelected && selectedId && (
            <RobotDetailPanel robotId={selectedId} />
          )}
          <AgentPanel />
        </div>
      </div>
    </main>
  )
}
