"use client"
import { useEffect, useRef, useState } from "react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useThreeScene } from "@/hooks/useThreeScene"
import { useSimulator } from "@/hooks/useSimulator"
import { useConfigSync } from "@/hooks/useConfigSync"
import { useRuleEngine } from "@/hooks/useRuleEngine"
import { FactoryCanvas } from "@/components/FactoryCanvas"
import { SensorChart } from "@/components/SensorChart"
import { AgentPanel } from "@/components/AgentPanel"
import { AlertBanner } from "@/components/AlertBanner"
import { ToastContainer } from "@/components/ToastContainer"
import { AlertHistory } from "@/components/AlertHistory"
import { Palette } from "@/components/Palette"
import { MachineDetailPanel } from "@/components/MachineDetailPanel"
import { RobotDetailPanel } from "@/components/RobotDetailPanel"
import { RuleEditorPanel } from "@/components/RuleEditorPanel"
import { MesReroutingViewer } from "@/components/MesReroutingViewer"
import { DashboardErrorBoundary } from "@sdf/ui"
import { LayoutControlBar, LayoutGrid } from "@/components/LayoutManager"
import { useFactoryStore } from "@/store/factoryStore"
import { bootstrapPlugins, pluginRegistry, pluginProps } from "@/lib/pluginBootstrap"
import type { LayoutPanelId } from "@sdf/types"

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const {
    robotPosRef, machineGroupsRef,
    updatePathLine, clearPathLine,
    updateRobotPath, updateComponentFault,
    applyMeshOverlay,
  } = useThreeScene(canvasRef)
  const { status: wsStatus } = useWebSocket(
    WS_URL, robotPosRef, machineGroupsRef,
    updatePathLine, clearPathLine, updateComponentFault, updateRobotPath,
  )

  useSimulator({ wsConnected: wsStatus === "connected" })
  useRuleEngine({ onMeshOverlay: applyMeshOverlay })
  const { exportToFile, importFromFile } = useConfigSync()

  useEffect(() => {
    bootstrapPlugins()
  }, [])

  const [editingLayout, setEditingLayout] = useState(false)

  const selectedId = useFactoryStore((s) => s.selectedEntityId)
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const placedMachines = placedEntities.filter((e) => e.type !== "robot")

  const selectedEntity = placedEntities.find((e) => e.id === selectedId)
  const isMachineSelected = selectedEntity ? selectedEntity.type !== "robot" : false
  const isRobotSelected = selectedEntity ? selectedEntity.type === "robot" : false
  const hasDetail = (isMachineSelected || isRobotSelected) && !!selectedId
  const selectedLabel = selectedEntity?.label

  // 레이아웃 패널 콘텐츠 맵
  const panelContent: Record<LayoutPanelId, React.ReactNode> = {
    canvas: (
      <FactoryCanvas canvasRef={canvasRef} />
    ),

    charts: (
      <div className="space-y-2">
        {placedMachines.length === 0 ? (
          <div className="bg-gray-900 rounded-lg p-4 text-xs text-gray-600 text-center">
            배치된 기계 없음
          </div>
        ) : (
          placedMachines.map((e) => (
            <SensorChart key={e.id} machineId={e.id} label={e.label} />
          ))
        )}
        <AlertHistory />
      </div>
    ),

    agent: (
      <AgentPanel />
    ),

    detail: hasDetail ? (
      isMachineSelected ? (
        <DashboardErrorBoundary label="MachineDetailPanel">
          <MachineDetailPanel machineId={selectedId!} label={selectedLabel} />
        </DashboardErrorBoundary>
      ) : (
        <DashboardErrorBoundary label="RobotDetailPanel">
          <RobotDetailPanel robotId={selectedId!} label={selectedLabel} />
        </DashboardErrorBoundary>
      )
    ) : (
      <div className="bg-gray-900 rounded-xl p-4 text-xs text-gray-600 text-center">
        기계 또는 로봇을 선택하세요
      </div>
    ),

    rules: (
      <div className="bg-gray-900 rounded-xl p-3">
        <DashboardErrorBoundary label="룰 엔진">
          <RuleEditorPanel />
        </DashboardErrorBoundary>
      </div>
    ),

    mes: (
      <DashboardErrorBoundary label="MES 이관 모니터">
        <MesReroutingViewer />
      </DashboardErrorBoundary>
    ),

    ...pluginRegistry.getPanelComponents(pluginProps),
  }

  return (
    <main className="bg-gray-950 text-white min-h-screen p-3 md:p-4">
      <ToastContainer />

      {/* 헤더 컨트롤바 */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h1 className="text-xl font-bold">SDF 디지털 트윈</h1>

        {/* WS 상태 */}
        <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
          wsStatus === "connected"  ? "bg-green-900 text-green-400" :
          wsStatus === "connecting" ? "bg-yellow-900 text-yellow-400" :
          wsStatus === "error"      ? "bg-red-900 text-red-400" :
                                      "bg-gray-800 text-gray-500"
        }`}>
          {wsStatus === "connected"  ? "● 연결됨" :
           wsStatus === "connecting" ? "○ 연결 중..." :
           wsStatus === "error"      ? "✕ 오류" : "✕ 연결 끊김"}
        </span>

        {/* 레이아웃 컨트롤바 */}
        <LayoutControlBar
          editingLayout={editingLayout}
          onToggle={() => setEditingLayout((v) => !v)}
        />

        {/* 내보내기/가져오기 */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={importFromFile}
            className="text-xs px-2.5 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors"
          >
            가져오기
          </button>
          <button
            onClick={exportToFile}
            className="text-xs px-2.5 py-1 rounded bg-blue-900 text-blue-300 hover:bg-blue-800 border border-blue-700 transition-colors"
          >
            내보내기
          </button>
        </div>
      </div>

      <AlertBanner />

      {/* 사이드바 + 메인 그리드 */}
      <div className="flex gap-3 items-start">
        <Palette />

        <div className="flex-1 min-w-0">
          <LayoutGrid
            editingLayout={editingLayout}
            panels={panelContent}
          />
        </div>
      </div>
    </main>
  )
}
