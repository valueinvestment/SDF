"use client"
import { useRef } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import { SensorChart } from "@/components/SensorChart"
import { AgentPanel } from "@/components/AgentPanel"
import { AlertBanner } from "@/components/AlertBanner"
import { ToastContainer } from "@/components/ToastContainer"
import { AlertHistory } from "@/components/AlertHistory"
import { Palette } from "@/components/Palette"
import { MachineDetailPanel } from "@/components/MachineDetailPanel"
import { RobotDetailPanel } from "@/components/RobotDetailPanel"
import { useFactoryStore } from "@/store/factoryStore"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const {
    robotPosRef, machineGroupsRef,
    updatePathLine, clearPathLine,
    updateRobotPath, updateComponentFault,
  } = useThreeScene(canvasRef)
  const { status: wsStatus } = useWebSocket(WS_URL, robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault, updateRobotPath)

  const selectedId = useFactoryStore((s) => s.selectedEntityId)
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const placedMachines = placedEntities.filter((e) => e.type !== "robot")

  const selectedEntity = placedEntities.find((e) => e.id === selectedId)
  const isMachineSelected = selectedEntity ? selectedEntity.type !== "robot" : false
  const isRobotSelected = selectedEntity ? selectedEntity.type === "robot" : false
  const hasDetail = (isMachineSelected || isRobotSelected) && !!selectedId
  const selectedLabel = selectedEntity?.label

  return (
    <main className="bg-gray-950 text-white min-h-screen p-3 md:p-4">
      <ToastContainer />
      <div className="flex items-center gap-3 mb-3">
        <h1 className="text-xl font-bold">SDF 디지털 트윈</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
          wsStatus === "connected"     ? "bg-green-900 text-green-400" :
          wsStatus === "connecting"    ? "bg-yellow-900 text-yellow-400" :
          wsStatus === "error"         ? "bg-red-900 text-red-400" :
                                        "bg-gray-800 text-gray-500"
        }`}>
          {wsStatus === "connected" ? "● 연결됨" :
           wsStatus === "connecting" ? "○ 연결 중..." :
           wsStatus === "error"      ? "✕ 오류" : "✕ 연결 끊김"}
        </span>
      </div>
      <AlertBanner />

      <div className="flex gap-3 items-start mt-3">
        <Palette />

        {/* Center column: canvas + charts — height independent of right panel */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <FactoryCanvas canvasRef={canvasRef} />

          {placedMachines.length > 0 && (
            <div className="flex flex-col gap-2">
              {placedMachines.map((e) => (
                <SensorChart key={e.id} machineId={e.id} label={e.label} />
              ))}
            </div>
          )}

          <AlertHistory />
        </div>

        {/* Right column: sticky so it overlays charts when tall */}
        <div className="flex gap-3 items-start flex-shrink-0 sticky top-4">
          {hasDetail && (
            <div className="w-64 flex-shrink-0">
              {isMachineSelected && <MachineDetailPanel machineId={selectedId!} label={selectedLabel} />}
              {isRobotSelected && <RobotDetailPanel robotId={selectedId!} label={selectedLabel} />}
            </div>
          )}
          <div className="w-56 xl:w-64 flex-shrink-0">
            <AgentPanel />
          </div>
        </div>
      </div>
    </main>
  )
}
